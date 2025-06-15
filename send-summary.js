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
    if (card.idMembers.includes(TRELLO_MEMBER_ID)) {
      if (card.due) {
        upcoming.push(`📌 ${card.name} – Due: ${new Date(card.due).toLocaleDateString()}`);
      }
    }

    if (card.checklists) {
      for (const list of card.checklists) {
        for (const item of list.checkItems) {
          if (item.name.includes(`@${TRELLO_MEMBER_ID}`)) {
            upcoming.push(`☑️ ${item.name} in ${card.name}`);
          }
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