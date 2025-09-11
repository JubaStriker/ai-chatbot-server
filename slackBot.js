import pkg from '@slack/bolt';
const { App } = pkg;
import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
dotenv.config();

const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true
});

// WebSocket server for frontend
const wss = new WebSocketServer({ port: 8081 });
let connectedClients = [];

wss.on('connection', (ws) => {
    console.log("✅ Frontend connected for replies");
    connectedClients.push(ws);

    ws.on('close', () => {
        connectedClients = connectedClients.filter(c => c !== ws);
    });
});

// Send message to WebSocket clients
function sendToClients(data) {
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Listen for human replies in Slack thread
slackApp.event('message', async ({ event, client }) => {
    if (event.thread_ts && !event.bot_id) {
        // Human replied in thread
        const text = event.text;
        const user = event.user;

        // Send reply back to frontend
        sendToClients({
            type: 'human_reply',
            user,
            message: text,
            thread_ts: event.thread_ts
        });
    }
});

export async function postEscalationMessage(question) {
    const result = await slackApp.client.chat.postMessage({
        channel: process.env.SLACK_CHANNEL_ID,
        text: `🚨 *AI Escalation Required!* \nUser asked: "${question}"\nPlease reply in this thread.`,
    });
    return result.ts; // thread timestamp for tracking
}

export async function startSlackBot() {
    await slackApp.start();
    console.log("🤖 Slack bot running...");
}
