const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_PASS = process.env.EMAIL_PASS;

const BOARD_IDS = ['JbK4j4yW', 'MAfPC0Xi', 'aUMYzTFu'];

async function getBoardMembers(boardId) {
  const res = await fetch(`https://api.trello.com/1/boards/${boardId}/members?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
  return res.json();
}

async function getCardsAndAssignments(boardId) {
  const memberTasks = {};

  const cardsRes = await fetch(`https://api.trello.com/1/boards/${boardId}/cards?fields=name,due,idMembers&key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
  const cards = await cardsRes.json();

  for (const card of cards) {
    // Card-level due date
    if (card.due && card.idMembers.length) {
      for (const id of card.idMembers) {
        if (!memberTasks[id]) memberTasks[id] = [];
        memberTasks[id].push({
          itemText: card.name,
          due: card.due,
          isCard: true
        });
      }
    }

    // Checklist items
    const checklistsRes = await fetch(`https://api.trello.com/1/cards/${card.id}/checklists?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`);
    const checklists = await checklistsRes.json();

    for (const checklist of checklists) {
      for (const item of checklist.checkItems) {
        if (item.due && item.idMember) {
          if (!memberTasks[item.idMember]) memberTasks[item.idMember] = [];
          memberTasks[item.idMember].push({
            itemText: `${item.name} (from "${card.name}")`,
            due: item.due,
            isCard: false
          });
        }
      }
    }
  }

  return memberTasks;
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
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));

  const pad = (n) => n.toString().padStart(2, "0");
  const formatDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
  const formatDate = (d) => `${formatDay(d)} ${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  const formatMonthDay = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  const groupKey = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split("T")[0];

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
  const withNewlines = textBody
    .replace(/\n(?=\*\*)/g, '\n\n')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

  return `
    <pre style="
      font-family: Aptos, Calibri, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    ">${withNewlines}</pre>
  `;
}

async function sendEmail(to, body) {
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_FROM,
      pass: EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: `"Trello Bot" <${EMAIL_FROM}>`,
    to,
    subject: "📝 Your Trello Tasks for Today",
    text: body,
    html: bodyToHTML(body),
  });
}

(async () => {
  const masterTasks = {}; // userId → array of tasks
  const emailMap = {};    // userId → email

  for (const boardId of BOARD_IDS) {
    const memberData = await getBoardMembers(boardId);
    memberData.forEach((m) => {
      if (m.email) emailMap[m.id] = m.email;
    });

    const tasks = await getCardsAndAssignments(boardId);
    for (const [userId, items] of Object.entries(tasks)) {
      if (!masterTasks[userId]) masterTasks[userId] = [];
      masterTasks[userId].push(...items);
    }
  }

  for (const [userId, items] of Object.entries(masterTasks)) {
    const email = emailMap[userId];
    if (!email) {
      console.warn(`⚠️ No email found for user ${userId}; skipping.`);
      continue;
    }

    const summary = formatSummary(items);
    console.log(`📬 Sending to ${email}:\n${summary}`);
    await sendEmail(email, summary);
  }
})();
