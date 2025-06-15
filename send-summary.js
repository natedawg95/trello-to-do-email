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
  const userItems = [];

  for (const card of cards) {
    console.log(`📎 ${card.name} – Members: ${card.idMembers?.join(", ")} – Due: ${card.due}`);

    // Top-level card due date
    if (card.due) {
      userItems.push(`📌 ${card.name} – Due: ${new Date(card.due).toLocaleDateString()}`);
    }
    

    // Fetch checklists on the card
    const checklistsRes = await fetch(`https://api.trello.com/1/cards/${card.id}/checklists?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
    const checklists = await checklistsRes.json();
    console.log(`📝 Found ${checklists.length} checklists on "${card.name}"`);


    // Fetch checklist assignment states
    const statesRes = await fetch(`https://api.trello.com/1/cards/${card.id}/checkItemStates?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
    const checkItemStates = await statesRes.json();

    console.log(`🔄 checkItemStates on "${card.name}":`, checkItemStates);


    for (const checklist of checklists) {
      console.log(`📋 Checklist: ${checklist.name} with ${checklist.checkItems.length} items`);
      

      for (const item of checklist.checkItems) {
        // Find matching state for this checklist item
        console.log(`🔍 Checking checklist item "${item.name}"`);
        console.log(`➡️ Checklist item raw:`, item);
        console.log(`➡️ Available checkItemStates:`, checkItemStates);

        const assigned = item.idMember === TRELLO_MEMBER_ID;

        if (item.due && assigned) {
          userItems.push(`☑️ ${item.name} (from "${card.name}") – Due: ${new Date(item.due).toLocaleDateString()}`);
        } else {
          console.log(`⛔️ SKIPPED: ${item.name} – Reason: ${!assigned ? 'Not assigned to user' : 'No due date'}`);
        }

      }
    }
  }

  return userItems;
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