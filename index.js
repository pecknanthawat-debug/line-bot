const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();

// ===== CONFIG =====
const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ===== ข้อมูลร้านค้า =====
const SHOP = {
  name: process.env.SHOP_NAME || "ร้านของฉัน",
  description: process.env.SHOP_DESCRIPTION || "ร้านค้าออนไลน์",
  payment: process.env.PAYMENT_METHODS || "โอนเงิน / พร้อมเพย์",
  shipping: process.env.SHIPPING_INFO || "ส่ง Kerry ทั่วประเทศ",
  hours: process.env.WORKING_HOURS || "จันทร์-เสาร์ 9:00-18:00",
  contact: process.env.CONTACT || "Line: @yourshop",
  returns: process.env.RETURN_POLICY || "คืนได้ภายใน 7 วัน",
};

const BOT_NAME = process.env.BOT_NAME || "บอท";

// ===== คำตอบสำเร็จรูป =====
const QUICK = {
  "ราคา": `💰 สอบถามราคาได้เลยครับ\nติดต่อ: ${SHOP.contact}`,
  "ส่ง": `🚚 ${SHOP.shipping}`,
  "จัดส่ง": `🚚 ${SHOP.shipping}`,
  "ชำระ": `💳 ${SHOP.payment}`,
  "จ่าย": `💳 ${SHOP.payment}`,
  "โอน": `💳 ${SHOP.payment}`,
  "พร้อมเพย์": `💳 ${SHOP.payment}`,
  "คืน": `🔄 ${SHOP.returns}`,
  "เปลี่ยน": `🔄 ${SHOP.returns}`,
  "เวลา": `🕐 ${SHOP.hours}`,
  "ทำการ": `🕐 ${SHOP.hours}`,
  "ติดต่อ": `📞 ${SHOP.contact}`,
  "สอบถาม": `📞 ${SHOP.contact}`,
};

function getQuick(text) {
  for (const [k, v] of Object.entries(QUICK)) {
    if (text.includes(k)) return v;
  }
  return null;
}

// ===== AI ตอบ =====
async function aiReply(text, userName) {
  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: `คุณเป็นพนักงานขายออนไลน์ของ "${SHOP.name}" ตอบภาษาไทย สุภาพ กระชับ ไม่เกิน 3 ประโยค
ข้อมูลร้าน: ${SHOP.description} | ชำระ: ${SHOP.payment} | ส่ง: ${SHOP.shipping} | เวลา: ${SHOP.hours} | ติดต่อ: ${SHOP.contact} | คืน: ${SHOP.returns}
ถ้าไม่รู้ให้บอกว่าจะตรวจสอบและแจ้งกลับ`,
    messages: [{ role: "user", content: `${userName} ถามว่า: ${text}` }],
  });
  return res.content[0].text;
}

// ===== ส่งข้อความ LINE =====
async function sendReply(replyToken, text) {
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text }],
  }, {
    headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
  });
}

// ===== ดึงชื่อผู้ใช้ =====
async function getName(userId) {
  try {
    const r = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` },
    });
    return r.data.displayName || "ลูกค้า";
  } catch { return "ลูกค้า"; }
}

app.use(express.json());

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  // ตอบ 200 ทันทีก่อนเสมอ
  res.status(200).json({ status: "ok" });

  try {
    const parsed = req.body;
    const events = parsed.events || [];

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const text = event.message.text.trim();
      const replyToken = event.replyToken;
      const userId = event.source?.userId;
      const isGroup = event.source?.type === "group" || event.source?.type === "room";

      const isMentioned = text.includes(`@${BOT_NAME}`) || !isGroup;
      const cleanText = text.replace(`@${BOT_NAME}`, "").trim();

      // คำตอบสำเร็จรูป
      const quick = getQuick(cleanText);
      if (quick) {
        await sendReply(replyToken, quick);
        continue;
      }

      // AI ตอบ (เฉพาะเมื่อ mention หรือ DM)
      if (isMentioned && cleanText.length > 0) {
        const name = userId ? await getName(userId) : "ลูกค้า";
        const reply = await aiReply(cleanText, name);
        await sendReply(replyToken, reply);
      }
    }
  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

// ===== Health check =====
app.get("/", (req, res) => {
  res.json({ status: "ok", shop: SHOP.name });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot running on port ${PORT}`);
  console.log(`🏪 Shop: ${SHOP.name}`);
});
