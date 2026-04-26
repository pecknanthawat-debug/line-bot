const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();

// ===== CONFIG =====
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ===== ข้อมูลร้านค้า (แก้ไขได้) =====
const SHOP_INFO = {
  name: process.env.SHOP_NAME || "ร้านของฉัน",
  description: process.env.SHOP_DESCRIPTION || "ร้านค้าออนไลน์จำหน่ายสินค้าคุณภาพดี",
  paymentMethods: process.env.PAYMENT_METHODS || "โอนเงิน / พร้อมเพย์ / บัตรเครดิต",
  shippingInfo: process.env.SHIPPING_INFO || "ส่ง Kerry / Flash Express ทั่วประเทศ ค่าส่งเริ่ม 40 บาท",
  workingHours: process.env.WORKING_HOURS || "จันทร์-เสาร์ 9:00-18:00 น.",
  contact: process.env.CONTACT || "Line: @shopname / Tel: 08x-xxx-xxxx",
  returnPolicy: process.env.RETURN_POLICY || "เปลี่ยนคืนได้ภายใน 7 วัน หากสินค้าชำรุดจากโรงงาน",
};

// ===== คำตอบสำเร็จรูป =====
const QUICK_ANSWERS = {
  ราคา: `💰 ราคาสินค้า\nกรุณาดูราคาที่แคตตาล็อกหรือติดต่อสอบถามเพิ่มเติมได้เลยครับ\n${SHOP_INFO.contact}`,
  ส่ง: `🚚 การจัดส่ง\n${SHOP_INFO.shippingInfo}\nสั่งก่อน 12:00 น. ส่งวันเดียวกันครับ`,
  ชำระ: `💳 วิธีชำระเงิน\n${SHOP_INFO.paymentMethods}`,
  จ่าย: `💳 วิธีชำระเงิน\n${SHOP_INFO.paymentMethods}`,
  โอน: `💳 วิธีชำระเงิน\n${SHOP_INFO.paymentMethods}`,
  คืน: `🔄 นโยบายคืนสินค้า\n${SHOP_INFO.returnPolicy}`,
  เปลี่ยน: `🔄 นโยบายคืนสินค้า\n${SHOP_INFO.returnPolicy}`,
  เวลา: `🕐 เวลาทำการ\n${SHOP_INFO.workingHours}`,
  ติดต่อ: `📞 ติดต่อเรา\n${SHOP_INFO.contact}`,
  สอบถาม: `📞 ติดต่อเรา\n${SHOP_INFO.contact}`,
};

// ===== ตรวจสอบคำตอบสำเร็จรูป =====
function getQuickAnswer(text) {
  for (const [keyword, answer] of Object.entries(QUICK_ANSWERS)) {
    if (text.includes(keyword)) {
      return answer;
    }
  }
  return null;
}

// ===== AI ตอบคำถาม =====
async function getAIResponse(userMessage, userName) {
  const systemPrompt = `คุณคือพนักงานขายออนไลน์ที่เป็นมิตรและเชี่ยวชาญของ "${SHOP_INFO.name}"

ข้อมูลร้าน:
- ร้าน: ${SHOP_INFO.name}
- รายละเอียด: ${SHOP_INFO.description}
- การชำระเงิน: ${SHOP_INFO.paymentMethods}
- การจัดส่ง: ${SHOP_INFO.shippingInfo}
- เวลาทำการ: ${SHOP_INFO.workingHours}
- ติดต่อ: ${SHOP_INFO.contact}
- นโยบายคืนสินค้า: ${SHOP_INFO.returnPolicy}

วิธีตอบ:
- ตอบภาษาไทยสุภาพ กระชับ เป็นมิตร ใช้คำว่า "ครับ" หรือ "ค่ะ"
- ตอบสั้นๆ ไม่เกิน 3-4 ประโยค
- ถ้าไม่รู้ข้อมูล ให้บอกว่าจะตรวจสอบและแจ้งกลับ
- ห้ามให้ข้อมูลที่ไม่มั่นใจ`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: `ลูกค้าชื่อ "${userName}" ถามว่า: ${userMessage}` }],
  });

  return response.content[0].text;
}

// ===== Webhook Handler =====
app.post("/webhook", middleware(lineConfig), async (req, res) => {
  res.status(200).json({ status: "ok" });

  const events = req.body.events;
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error("Event error:", err);
    }
  }
});

async function handleEvent(event) {
  // รับเฉพาะ text message
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const replyToken = event.replyToken;

  // ดึงชื่อผู้ใช้
  let userName = "ลูกค้า";
  try {
    if (event.source.userId) {
      const profile = await lineClient.getProfile(event.source.userId);
      userName = profile.displayName;
    }
  } catch (e) {}

  // ตรวจสอบ @mention ในกลุ่ม (ถ้ามี)
  const isGroup = event.source.type === "group" || event.source.type === "room";
  const botName = process.env.BOT_NAME || "บอท";
  const isMentioned = text.includes(`@${botName}`) || !isGroup;

  // ในกลุ่ม: ตอบเฉพาะเมื่อถูก mention หรือถามคำที่ตรงกับ quick answers
  const cleanText = text.replace(`@${botName}`, "").trim();

  let replyText = null;

  // ลองคำตอบสำเร็จรูปก่อน
  replyText = getQuickAnswer(cleanText);

  // ถ้าไม่มี quick answer และถูก mention หรืออยู่ใน DM -> ให้ AI ตอบ
  if (!replyText && (isMentioned || !isGroup)) {
    try {
      replyText = await getAIResponse(cleanText, userName);
    } catch (err) {
      console.error("AI error:", err);
      replyText = `ขอโทษครับ ขณะนี้ระบบขัดข้อง กรุณาติดต่อ ${SHOP_INFO.contact}`;
    }
  }

  // ส่งข้อความตอบกลับ
  if (replyText) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: replyText,
    });
  }
}

// ===== Health check =====
app.get("/", (req, res) => {
  res.json({ status: "LINE Bot is running 🤖", shop: SHOP_INFO.name });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot running on port ${PORT}`);
  console.log(`🏪 Shop: ${SHOP_INFO.name}`);
});
