const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.TRELLO_BOARD_ID;
const USER_EMAIL = process.env.USER_EMAIL;
const TRELLO_MEMBER_ID = process.env.TRELLO_MEMBER_ID;

async function getCardsWithDueDates() {
  const res = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/cards?fields=name,due,idMembers&checklists=all&key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
  const cards = await res.json();

  console.log("Fetched cards:");
  cards.forEach(card => {
    console.log(`📎 ${card.name} – Members: ${card.idMembers.join(", ")} – Due: ${card.due}`);
  });

  const now = new Date();
  const upcoming = [];

  for (const card of cards) {
    if (card.due) {
      upcoming.push(`📌 ${card.name} – Due: ${new Date(card.due).toLocaleDateString()}`);
    }
    

    // Now get checklists
    for (const checklistId of card.idChecklists || []) {
      const checklistResp = await fetch(`https://api.trello.com/1/checklists/${checklistId}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
      const checklist = await checklistResp.json();

      for (const item of checklist.checkItems || []) {
        // We need to get the full check item to access member/due info
        const checkItemDetailsResp = await fetch(`https://api.trello.com/1/cards/${card.id}/checkItem/${item.id}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
        const checkItemDetails = await checkItemDetailsResp.json();

        const assignedToMe = checkItemDetails.idMember && checkItemDetails.idMember === TRELLO_MEMBER_ID;
        const hasDue = checkItemDetails.due;

        if (assignedToMe && hasDue) {
          upcoming.push(`✅ ${card.name} › ${item.name} – Due: ${new Date(checkItemDetails.due).toLocaleDateString()}`);
        }
      }
    }
  }

  return upcoming;
}

async function sendEmail(body) {
  console.log("Preparing to send email to", USER_EMAIL);
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASS,
    },
  });
  

  await transporter.sendMail({
    from: `"Trello Bot" <${process.env.EMAIL_FROM}>`,
    to: USER_EMAIL,
    subject: "📝 Your Trello Tasks for Today",
    text: body.join("\n"),
  });
}

(async () => {
  const summary = await getCardsWithDueDates();
  console.log("Summary output:");
  console.log(summary);
  if (summary.length) {
    console.log("Sending email...");
    await sendEmail(summary);
  } else {
    console.log("No items found for user; skipping email.");
  }
})();