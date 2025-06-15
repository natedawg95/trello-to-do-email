const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.TRELLO_BOARD_ID;
const USER_EMAIL = process.env.USER_EMAIL;
const TRELLO_MEMBER_ID = process.env.TRELLO_MEMBER_ID;

async function getCardsWithDueDates() {
  const res = await fetch(`https://api.trello.com/1/boards/${BOARD_ID}/cards?fields=name,due,idMembers&key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
  const cards = await res.json();
  console.log("Fetched cards:");
  const userItemsWithDates = [];

  for (const card of cards) {
    console.log(`📎 ${card.name} – Members: ${card.idMembers?.join(", ")} – Due: ${card.due}`);

    // Top-level card due date
    if (card.due && card.idMembers.includes(TRELLO_MEMBER_ID)) {
      userItemsWithDates.push({
        itemText: `📌 ${card.name}`,
        due: card.due
      });
    }

    // Fetch checklists on the card
    const checklistsRes = await fetch(`https://api.trello.com/1/cards/${card.id}/checklists?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
    const checklists = await checklistsRes.json();
    console.log(`📝 Found ${checklists.length} checklists on "${card.name}"`);

    for (const checklist of checklists) {
      console.log(`📋 Checklist: ${checklist.name} with ${checklist.checkItems.length} items`);
      for (const item of checklist.checkItems) {
        console.log(`🔍 Checking checklist item "${item.name}"`);
        console.log(`➡️ Checklist item raw:`, item);

        const assigned = item.idMember === TRELLO_MEMBER_ID;

        if (item.due && assigned) {
          userItemsWithDates.push({
            itemText: `☑️ ${item.name} (from "${card.name}")`,
            due: item.due
          });
        } else {
          console.log(`⛔️ SKIPPED: ${item.name} – Reason: ${!assigned ? 'Not assigned to user' : 'No due date'}`);
        }
      }
    }
  }

  return userItemsWithDates;
}

function formatSummary(userItemsWithDates) {
  const categorized = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
  };

  const now = new Date();
  const todayStr = now.toDateString();
  const endOfWeek = new Date();
  endOfWeek.setDate(now.getDate() + (7 - now.getDay())); // Sunday

  const formatDate = (d) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  userItemsWithDates
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .forEach(({ itemText, due }) => {
      const dueDate = new Date(due);
      const dueStr = dueDate.toDateString();

      if (dueDate < now && dueStr !== todayStr) {
        categorized.overdue.push(itemText);
      } else if (dueStr === todayStr) {
        categorized.today.push(itemText);
      } else if (dueDate <= endOfWeek) {
        categorized.thisWeek.push(`${dueDate.toLocaleDateString(undefined, { weekday: 'short' })} – ${itemText}`);
      } else {
        categorized.later.push(`${formatDate(dueDate)} – ${itemText}`);
      }
    });

  let summary = [];

  if (categorized.overdue.length)
    summary.push("🚨 Overdue!!", ...categorized.overdue);

  if (categorized.today.length)
    summary.push("📅 Today:", ...categorized.today);

  if (categorized.thisWeek.length)
    summary.push("🗓 This Week:", ...categorized.thisWeek);

  if (categorized.later.length)
    summary.push("📆 Later:", ...categorized.later);

  return summary.join("\n");
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
    text: body,
  });
}

(async () => {
  const items = await getCardsWithDueDates();
  console.log("Summary items:", items);
  if (items.length) {
    const formatted = formatSummary(items);
    console.log("Final formatted summary:\n", formatted);
    await sendEmail(formatted);
  } else {
    console.log("No items found for user; skipping email.");
  }
})();
