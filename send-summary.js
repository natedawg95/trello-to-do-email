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
        itemText: card.name,
        due: card.due,
        isCard: true
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
            itemText: `${item.name} (from "${card.name}")`,
            due: item.due,
            isCard: false
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
    thisWeek: {},
    future: [],
  };

  const now = new Date();
  const todayStr = now.toDateString();
  const endOfWeek = new Date();
  endOfWeek.setDate(now.getDate() + (7 - now.getDay())); // Sunday

  const pad = (n) => n.toString().padStart(2, "0");

  const formatDay = (d) =>
    d.toLocaleDateString(undefined, { weekday: 'short' });

  const formatDate = (d) =>
    `${formatDay(d)} ${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

  const formatMonthDay = (d) =>
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

  const groupKey = (d) => {
    const keyDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return keyDate.toISOString().split("T")[0];
  };

  userItemsWithDates
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .forEach(({ itemText, due, isCard }) => {
      const dueDate = new Date(due);
      const dueStr = dueDate.toDateString();
      const dueKey = groupKey(dueDate);

      if (dueDate < now && dueStr !== todayStr) {
        categorized.overdue.push(formatItem(itemText, isCard));
      } else if (dueStr === todayStr) {
        categorized.today.push(formatItem(itemText, isCard));
      } else if (dueDate <= endOfWeek) {
        if (!categorized.thisWeek[dueKey]) {
          categorized.thisWeek[dueKey] = {
            label: `${formatDay(dueDate)} (${formatMonthDay(dueDate)})`,
            items: [],
          };
        }
        categorized.thisWeek[dueKey].items.push(formatItem(itemText, isCard));
      } else {
        categorized.future.push(`${formatItem(itemText, isCard)} (${formatDay(dueDate)} ${formatMonthDay(dueDate)})`);
      }
    });

  let summary = [];

  if (categorized.overdue.length) {
    summary.push(`⚠️**Overdue**`, ...indentList(categorized.overdue));
  }

  if (categorized.today.length) {
    summary.push(`**Today (${formatMonthDay(now)})**`, ...indentList(categorized.today));
  }

  if (Object.keys(categorized.thisWeek).length) {
    summary.push(`**This Week**`);
    for (const key of Object.keys(categorized.thisWeek)) {
      summary.push(`    ${categorized.thisWeek[key].label}`, ...indentList(categorized.thisWeek[key].items, 2));
    }
  }

  if (categorized.future.length) {
    summary.push(`**Future**`, ...indentList(categorized.future));
  }

  return summary.join("\n");
}

function formatItem(text, isCard) {
  if (isCard) {
    return `🃏 ${text}`;
  } else {
    const match = text.match(/\(from "(.*?)"\)/);
    const cardName = match ? match[1] : "Unknown";
    const task = text.replace(/\s*\(from.*?\)$/, "").trim();
    return `✔ ${task} (🃏 ${cardName})`;
  }
}

function indentList(list, indentLevel = 1) {
  const indent = "    ".repeat(indentLevel);
  return list.map((item) => `${indent}${item}`);
}

function bodyToHTML(textBody) {
  return `<pre style="font-family: monospace; font-size: 14px;">${textBody
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')}</pre>`;
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
    text: body,         // Fallback for clients that can't render HTML
    html: bodyToHTML(body),  // Real formatting
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
