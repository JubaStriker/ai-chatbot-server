import pkg from '@slack/bolt';
const { App } = pkg;
import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { OpenAIEmbeddings } from '@langchain/openai';
import {
    MessageRepository,
    EscalationRepository,
    HumanLearningRepository
} from './models/database.js';

const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true
});

// WebSocket server for frontend
const wss = new WebSocketServer({ port: 8081 });
// Store connected clients with their session IDs and connection IDs
const connectedClients = new Map(); // sessionId -> Set of {connectionId, ws, connectedAt}
// Store thread_ts to sessionId mapping for escalations
const threadToSession = new Map(); // thread_ts -> sessionId
// Store thread_ts to original question mapping for learning
const threadToQuestion = new Map(); // thread_ts -> original question
// Store pending messages for disconnected sessions
const pendingMessages = new Map(); // sessionId -> array of messages

wss.on('connection', (ws, req) => {
    // Get session ID from query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    let sessionId = url.searchParams.get('sessionId');
    
    // Generate unique connection ID for this specific connection
    const connectionId = uuidv4();

    if (!sessionId) {
        sessionId = uuidv4();
    }

    console.log(`✅ Frontend connected - Session: ${sessionId}, Connection: ${connectionId}`);
    
    // Initialize session connections if not exists
    if (!connectedClients.has(sessionId)) {
        connectedClients.set(sessionId, new Set());
    }
    
    // Add this connection to the session
    const connectionInfo = {
        connectionId,
        ws,
        connectedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
    };
    connectedClients.get(sessionId).add(connectionInfo);
    
    console.log(`📊 Session ${sessionId} now has ${connectedClients.get(sessionId).size} active connection(s)`);

    // Send session ID and connection ID to client
    ws.send(JSON.stringify({
        type: 'session_established',
        sessionId,
        connectionId
    }));

    // Send any pending messages for this session (only to this connection to avoid duplicates)
    const pending = pendingMessages.get(sessionId);
    if (pending && pending.length > 0) {
        console.log(`📮 Delivering ${pending.length} pending messages to session ${sessionId}, connection ${connectionId}`);
        pending.forEach(message => {
            ws.send(JSON.stringify({
                ...message,
                deliveryMode: 'queued_delivery',
                deliveredAt: new Date().toISOString(),
                deliveredToConnection: connectionId
            }));
        });
        // Clear pending messages after delivery (only clear once per session, not per connection)
        pendingMessages.delete(sessionId);
    }

    // Handle connection close
    ws.on('close', () => {
        console.log(`❌ Frontend disconnected - Session: ${sessionId}, Connection: ${connectionId}`);
        const sessionConnections = connectedClients.get(sessionId);
        if (sessionConnections) {
            // Remove this specific connection
            for (const conn of sessionConnections) {
                if (conn.connectionId === connectionId) {
                    sessionConnections.delete(conn);
                    break;
                }
            }
            
            // If no more connections for this session, remove the session
            if (sessionConnections.size === 0) {
                connectedClients.delete(sessionId);
                console.log(`🗑️ Removed session ${sessionId} - no active connections`);
            } else {
                console.log(`📊 Session ${sessionId} still has ${sessionConnections.size} active connection(s)`);
            }
        }
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`WebSocket error - Session: ${sessionId}, Connection: ${connectionId}:`, error);
    });
    
    // Handle ping/pong for connection health
    ws.on('pong', () => {
        connectionInfo.lastActivity = new Date().toISOString();
    });
});

// Function to send message to specific client or all clients
function sendToClients(message, targetSessionId = null) {
    console.log(`🔍 Looking for session: ${targetSessionId}`);
    console.log(`🔍 Connected sessions: ${Array.from(connectedClients.keys()).join(', ')}`);
    
    if (targetSessionId) {
        // Send to specific session (all connections for that session)
        const sessionConnections = connectedClients.get(targetSessionId);
        if (sessionConnections && sessionConnections.size > 0) {
            let successCount = 0;
            let totalConnections = sessionConnections.size;
            
            sessionConnections.forEach(connectionInfo => {
                if (connectionInfo.ws.readyState === 1) { // WebSocket.OPEN
                    connectionInfo.ws.send(JSON.stringify({
                        ...message,
                        deliveredToConnection: connectionInfo.connectionId
                    }));
                    connectionInfo.lastActivity = new Date().toISOString();
                    successCount++;
                }
            });
            
            if (successCount > 0) {
                console.log(`📤 Sent message to session ${targetSessionId} (${successCount}/${totalConnections} connections)`);
                return true;
            } else {
                console.log(`⚠️ No active connections for session ${targetSessionId} (${totalConnections} stale connections)`);
                // Clean up stale connections
                connectedClients.delete(targetSessionId);
            }
        } else {
            console.log(`⚠️ Session ${targetSessionId} not found`);
        }
        
        // Store the message for when the user reconnects
        console.log(`💾 Queueing message for session ${targetSessionId}`);
        if (!pendingMessages.has(targetSessionId)) {
            pendingMessages.set(targetSessionId, []);
        }
        pendingMessages.get(targetSessionId).push({
            ...message,
            queuedAt: new Date().toISOString()
        });
        console.log(`📥 Message queued. Pending count: ${pendingMessages.get(targetSessionId).length}`);
        
        // DO NOT broadcast to other sessions - only queue for the correct session
        console.log(`🚫 Will NOT broadcast to other sessions - message is queued for correct session only`);
        console.log(`⏳ Message will be delivered when session ${targetSessionId} reconnects`)
        
        return false;
    } else {
        // Send to all connected clients (all sessions, all connections)
        let totalSent = 0;
        connectedClients.forEach((sessionConnections, sessionId) => {
            sessionConnections.forEach(connectionInfo => {
                if (connectionInfo.ws.readyState === 1) { // WebSocket.OPEN
                    connectionInfo.ws.send(JSON.stringify({
                        ...message,
                        deliveredToConnection: connectionInfo.connectionId
                    }));
                    connectionInfo.lastActivity = new Date().toISOString();
                    totalSent++;
                }
            });
        });
        console.log(`📤 Broadcasted message to ${totalSent} connections across ${connectedClients.size} sessions`);
        return true;
    }
}

// Listen for human replies in Slack thread
slackApp.event('message', async ({ event, client }) => {
    if (event.thread_ts && !event.bot_id) {
        // Human replied in thread
        const text = event.text;
        const user = event.user;
        const thread_ts = event.thread_ts;

        console.log('Human reply in thread:', text, 'Thread:', thread_ts);
        console.log('🔍 Available thread mappings:', Array.from(threadToSession.entries()));

        // Find the session associated with this thread
        const sessionId = threadToSession.get(thread_ts);
        const originalQuestion = threadToQuestion.get(thread_ts);
        console.log('🎯 Found session for thread:', sessionId);
        console.log('📚 Original question for learning:', originalQuestion);

        if (sessionId && originalQuestion) {
            console.log('✅ Valid thread-to-session mapping found');
            console.log('🔍 Checking if session is currently connected...');

            // ========== SAVE Q&A PAIR FOR AI LEARNING ==========
            try {
                const embeddings = new OpenAIEmbeddings({
                    openAIApiKey: process.env.OPENAI_API_KEY,
                });

                await HumanLearningRepository.saveQAPair(
                    originalQuestion,
                    text, // human answer
                    sessionId,
                    thread_ts,
                    {
                        slackUserId: user,
                        agentName: 'Human Agent' // You can enhance this by looking up actual name
                    },
                    'en', // You can detect language here too
                    embeddings // Pass embeddings for semantic matching
                );
                console.log('🧠 Q&A pair saved for AI learning!');
                console.log(`📖 Question: "${originalQuestion}"`);
                console.log(`💬 Answer: "${text}"`);
            } catch (error) {
                console.error('❌ Error saving Q&A pair for learning:', error);
            }
            // ================================================
            
            // Check if this session is actually connected
            const isSessionConnected = connectedClients.has(sessionId);
            const sessionConnections = connectedClients.get(sessionId);
            const activeConnectionCount = sessionConnections ? sessionConnections.size : 0;
            
            console.log(`📊 Session ${sessionId} status: ${isSessionConnected ? 'CONNECTED' : 'NOT CONNECTED'}`);
            console.log(`📊 Active connections for this session: ${activeConnectionCount}`);
            
            // Send reply to the specific user session
            const delivered = sendToClients({
                type: 'human_reply',
                user,
                message: text,
                thread_ts: thread_ts,
                sessionId: sessionId,
                timestamp: new Date().toISOString()
            }, sessionId);
            
            if (delivered) {
                console.log('✅ Message delivered to active session');
            } else {
                console.log('📥 Message queued - session will receive it when they reconnect');
            }

            // Also save the human reply to the database
            // try {
            //     const { MessageRepository } = await import('./models/database.js');
            //     await MessageRepository.create({
            //         sessionId,
            //         messageId: uuidv4(),
            //         sender: 'human_agent',
            //         senderInfo: { slackUserId: user },
            //         content: { text },
            //         metadata: {
            //             slackThreadTs: thread_ts,
            //             responseTime: 0,
            //             isEscalated: true
            //         }
            //     });
            //     console.log('✅ Human reply saved to database');
            // } catch (error) {
            //     console.error('❌ Error saving human reply to database:', error);
            // }
        } else if (sessionId && !originalQuestion) {
            console.log('⚠️ Session found but no original question stored - possibly an old thread');
            // Still send the reply to user but can't learn from it
            const delivered = sendToClients({
                type: 'human_reply',
                user,
                message: text,
                thread_ts: thread_ts,
                sessionId: sessionId,
                timestamp: new Date().toISOString()
            }, sessionId);

            if (delivered) {
                console.log('✅ Message delivered to active session (no learning)');
            } else {
                console.log('📥 Message queued - session will receive it when they reconnect (no learning)');
            }
        } else {
            console.log(`❌ No session mapping found for thread ${thread_ts}`);
            console.log(`🚫 Ignoring message - this thread is not associated with any user session`);
            console.log(`💡 This might be a manual Slack thread or an old thread from before the mapping system`);
            // DO NOT send to any frontend - this message has no valid session mapping
            return;
        }
    }
});

export async function postEscalationMessage(question, sessionId) {

    try {
        const { SessionRepository } = await import('./models/database.js');
        const session = await SessionRepository.findById(sessionId);

        const blocks = [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: "🚨 AI Escalation Required"
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*User Question:*\n${question}`
                }
            },

        ];

        const userContext = null;

        // Add user context if available
        if (userContext && (session?.userInfo || userContext.email || userContext.name)) {
            const fields = [];

            if (userContext.name || session?.userInfo?.name) {
                fields.push({
                    type: "mrkdwn",
                    text: `*User:* ${userContext.name || session.userInfo.name}`
                });
            }

            if (userContext.email || session?.userInfo?.email) {
                fields.push({
                    type: "mrkdwn",
                    text: `*Email:* ${userContext.email || session.userInfo.email}`
                });
            }

            if (session?.metadata?.totalMessages) {
                fields.push({
                    type: "mrkdwn",
                    text: `*Messages in session:* ${session.metadata.totalMessages}`
                });
            }

            if (fields.length > 0) {
                blocks.push({
                    type: "section",
                    fields
                });
            }
        }

        blocks.push({
            type: "divider"
        });

        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: "⬇️ *Please reply in this thread to answer the user*\n✅ React with :white_check_mark: when resolved"
            }
        });

        const result = await slackApp.client.chat.postMessage({
            channel: process.env.SLACK_CHANNEL_ID,
            blocks,
            text: `AI Escalation: "${question}"` // Fallback text
        });

        // Store the mapping between thread timestamp and session ID
        if (result.ts) {
            threadToSession.set(result.ts, sessionId);
            threadToQuestion.set(result.ts, question); // Store original question for learning
            console.log(`📝 Mapped thread ${result.ts} to session ${sessionId}`);
            console.log(`📚 Stored question for learning: "${question}"`);
        }

        return result.ts; // thread timestamp for tracking
    } catch (error) {
        console.error('Error posting escalation message to Slack:', error);
        return null;
    }
}

// Connection health monitoring and cleanup
setInterval(() => {
    const now = new Date();
    let cleanedConnections = 0;
    let cleanedSessions = 0;
    
    connectedClients.forEach((sessionConnections, sessionId) => {
        const activeConnections = new Set();
        
        sessionConnections.forEach(connectionInfo => {
            // Check if connection is still alive
            if (connectionInfo.ws.readyState === 1) { // WebSocket.OPEN
                // Send ping to check if connection is responsive
                try {
                    connectionInfo.ws.ping();
                    activeConnections.add(connectionInfo);
                } catch (error) {
                    console.log(`🧹 Cleaning up dead connection: ${connectionInfo.connectionId} for session ${sessionId}`);
                    cleanedConnections++;
                }
            } else {
                console.log(`🧹 Cleaning up closed connection: ${connectionInfo.connectionId} for session ${sessionId}`);
                cleanedConnections++;
            }
        });
        
        if (activeConnections.size === 0) {
            // No active connections for this session
            connectedClients.delete(sessionId);
            cleanedSessions++;
        } else if (activeConnections.size !== sessionConnections.size) {
            // Some connections were cleaned up, update the set
            connectedClients.set(sessionId, activeConnections);
        }
    });
    
    if (cleanedConnections > 0 || cleanedSessions > 0) {
        console.log(`🧹 Cleanup completed: ${cleanedConnections} connections, ${cleanedSessions} sessions removed`);
    }
}, 30000); // Run every 30 seconds

export async function startSlackBot() {
    await slackApp.start();
    console.log("🤖 Slack bot running...");
}

// Function to get connection status (for debugging)
export function getConnectionStatus() {
    const activeConnections = [];
    let totalConnections = 0;
    
    connectedClients.forEach((sessionConnections, sessionId) => {
        const connections = Array.from(sessionConnections).map(conn => ({
            connectionId: conn.connectionId,
            readyState: conn.ws.readyState,
            readyStateText: conn.ws.readyState === 0 ? 'CONNECTING' : 
                          conn.ws.readyState === 1 ? 'OPEN' :
                          conn.ws.readyState === 2 ? 'CLOSING' : 'CLOSED',
            connectedAt: conn.connectedAt,
            lastActivity: conn.lastActivity
        }));
        
        activeConnections.push({
            sessionId,
            connectionCount: connections.length,
            connections
        });
        
        totalConnections += connections.length;
    });
    
    return {
        summary: {
            totalSessions: connectedClients.size,
            totalConnections,
            pendingMessageSessions: pendingMessages.size
        },
        connectedSessions: Array.from(connectedClients.keys()),
        threadMappings: Array.from(threadToSession.entries()),
        pendingMessages: Array.from(pendingMessages.entries()).map(([sessionId, messages]) => ({
            sessionId,
            messageCount: messages.length,
            oldestMessage: messages.length > 0 ? messages[0].queuedAt : null
        })),
        activeConnections
    };
}

// Export the sendToClients function for use by other modules
export { sendToClients };
