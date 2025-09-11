// models/database.js - MongoDB Schema and Connection
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Connect to MongoDB
export async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/transfi-chatbot', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ MongoDB connected successfully');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

// ============= SCHEMAS =============

// User Session Schema
const SessionSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userInfo: {
        name: String,
        email: String,
        ipAddress: String,
        userAgent: String,
        location: Object
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastActiveAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'banned'],
        default: 'active'
    },
    metadata: {
        totalMessages: { type: Number, default: 0 },
        totalEscalations: { type: Number, default: 0 },
        satisfactionRating: Number,
        tags: [String]
    }
});

// Conversation/Message Schema
const MessageSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        index: true
    },
    messageId: {
        type: String,
        required: true,
        unique: true
    },
    sender: {
        type: String,
        enum: ['user', 'bot', 'human', 'system'],
        required: true
    },
    senderInfo: {
        name: String,
        agentId: String, // For human agents
        model: String    // For AI (gpt-3.5, gpt-4, etc.)
    },
    content: {
        text: {
            type: String,
            required: true
        },
        attachments: [{
            type: String,
            url: String,
            size: Number
        }]
    },
    metadata: {
        intent: String,           // Detected intent
        sentiment: String,        // Positive, negative, neutral
        confidence: Number,       // AI confidence score
        isEscalated: Boolean,
        escalationReason: String,
        threadTs: String,        // Slack thread ID
        sources: [{
            content: String,
            source: String
        }],
        responseTime: Number,    // Time to respond in ms
        tokens: {
            prompt: Number,
            completion: Number
        }
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },
    edited: {
        isEdited: { type: Boolean, default: false },
        editedAt: Date,
        previousContent: String
    }
});

// Escalation Schema
const EscalationSchema = new mongoose.Schema({
    escalationId: {
        type: String,
        required: true,
        unique: true
    },
    sessionId: {
        type: String,
        required: true,
        index: true
    },
    threadTs: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    question: {
        type: String,
        required: true
    },
    reason: {
        type: String,
        enum: ['low_confidence', 'user_request', 'sentiment_negative', 'complex_query', 'error'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'assigned', 'in_progress', 'resolved', 'abandoned'],
        default: 'pending',
        index: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    assignedTo: {
        agentId: String,
        agentName: String,
        assignedAt: Date
    },
    slackChannel: String,
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    resolvedAt: Date,
    resolutionTime: Number, // in seconds
    resolution: {
        answer: String,
        answeredBy: String,
        satisfactory: Boolean,
        notes: String
    },
    tags: [String],
    userContext: Object
});

// Analytics Schema
const AnalyticsSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        index: true
    },
    metrics: {
        totalSessions: Number,
        totalMessages: Number,
        totalEscalations: Number,
        resolvedEscalations: Number,
        averageResponseTime: Number,
        averageResolutionTime: Number,
        satisfactionScore: Number,
        aiConfidenceAverage: Number
    },
    topQuestions: [{
        question: String,
        count: Number
    }],
    topIntents: [{
        intent: String,
        count: Number
    }],
    agentPerformance: [{
        agentId: String,
        agentName: String,
        escalationsHandled: Number,
        averageResolutionTime: Number,
        satisfactionScore: Number
    }],
    hourlyDistribution: [{
        hour: Number,
        messageCount: Number
    }]
});

// Knowledge Base Cache Schema (for faster retrieval)
const KnowledgeCacheSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
        index: true
    },
    questionEmbedding: [Number], // Store vector embedding
    answer: {
        type: String,
        required: true
    },
    sources: [{
        content: String,
        source: String
    }],
    confidence: Number,
    usageCount: {
        type: Number,
        default: 0
    },
    lastUsed: Date,
    createdAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: () => new Date(+new Date() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
});

// Feedback Schema
const FeedbackSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        index: true
    },
    messageId: String,
    rating: {
        type: Number,
        min: 1,
        max: 5,
        required: true
    },
    feedback: String,
    category: {
        type: String,
        enum: ['helpful', 'not_helpful', 'incorrect', 'incomplete', 'other']
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Create indexes for better performance
MessageSchema.index({ sessionId: 1, timestamp: -1 });
MessageSchema.index({ 'metadata.threadTs': 1 });
EscalationSchema.index({ status: 1, createdAt: -1 });
KnowledgeCacheSchema.index({ question: 'text' });

// Create models
export const Session = mongoose.model('Session', SessionSchema);
export const Message = mongoose.model('Message', MessageSchema);
export const Escalation = mongoose.model('Escalation', EscalationSchema);
export const Analytics = mongoose.model('Analytics', AnalyticsSchema);
export const KnowledgeCache = mongoose.model('KnowledgeCache', KnowledgeCacheSchema);
export const Feedback = mongoose.model('Feedback', FeedbackSchema);

// ============= REPOSITORY FUNCTIONS =============

// Session Management
export const SessionRepository = {
    async create(sessionId, userInfo = {}) {
        const session = new Session({
            sessionId,
            userInfo,
            lastActiveAt: new Date()
        });
        return await session.save();
    },

    async findById(sessionId) {
        return await Session.findOne({ sessionId });
    },

    async updateActivity(sessionId) {
        return await Session.findOneAndUpdate(
            { sessionId },
            {
                lastActiveAt: new Date(),
                $inc: { 'metadata.totalMessages': 1 }
            },
            { new: true }
        );
    },

    async getActiveSessions(minutes = 30) {
        const cutoff = new Date(Date.now() - minutes * 60 * 1000);
        return await Session.find({
            lastActiveAt: { $gte: cutoff },
            status: 'active'
        });
    }
};

// Message Management
export const MessageRepository = {
    async create(messageData) {
        const message = new Message(messageData);
        return await message.save();
    },

    async getConversation(sessionId, limit = 50) {
        return await Message.find({ sessionId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
    },

    async getByThreadTs(threadTs) {
        return await Message.find({ 'metadata.threadTs': threadTs })
            .sort({ timestamp: 1 })
            .lean();
    },

    async searchMessages(query, sessionId = null) {
        const filter = {
            'content.text': { $regex: query, $options: 'i' }
        };
        if (sessionId) filter.sessionId = sessionId;

        return await Message.find(filter)
            .sort({ timestamp: -1 })
            .limit(20)
            .lean();
    }
};

// Escalation Management
export const EscalationRepository = {
    async create(escalationData) {
        const escalation = new Escalation(escalationData);
        await Session.findOneAndUpdate(
            { sessionId: escalationData.sessionId },
            { $inc: { 'metadata.totalEscalations': 1 } }
        );
        return await escalation.save();
    },

    async findByThreadTs(threadTs) {
        return await Escalation.findOne({ threadTs });
    },

    async findBySessionId(sessionId) {
        return await Escalation.find({ sessionId })
            .sort({ createdAt: -1 });
    },

    async updateStatus(threadTs, status, agentInfo = null) {
        const update = { status };
        if (agentInfo) {
            update.assignedTo = {
                ...agentInfo,
                assignedAt: new Date()
            };
        }
        if (status === 'resolved') {
            update.resolvedAt = new Date();
        }

        const escalation = await Escalation.findOneAndUpdate(
            { threadTs },
            update,
            { new: true }
        );

        // Calculate resolution time
        if (escalation && status === 'resolved') {
            escalation.resolutionTime = Math.floor(
                (escalation.resolvedAt - escalation.createdAt) / 1000
            );
            await escalation.save();
        }

        return escalation;
    },

    async getPending() {
        return await Escalation.find({
            status: { $in: ['pending', 'assigned'] }
        }).sort({ priority: -1, createdAt: 1 });
    },

    async getStats(days = 7) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return await Escalation.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    resolved: {
                        $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] }
                    },
                    avgResolutionTime: {
                        $avg: '$resolutionTime'
                    },
                    byReason: {
                        $push: '$reason'
                    }
                }
            }
        ]);
    }
};

// Knowledge Cache Management
export const KnowledgeCacheRepository = {
    async findAnswer(question) {
        // First try exact match
        let cached = await KnowledgeCache.findOne({ question });

        // If not found, try text search
        if (!cached) {
            cached = await KnowledgeCache.findOne(
                { $text: { $search: question } },
                { score: { $meta: 'textScore' } }
            ).sort({ score: { $meta: 'textScore' } });
        }

        if (cached) {
            // Update usage stats
            await KnowledgeCache.findByIdAndUpdate(cached._id, {
                $inc: { usageCount: 1 },
                lastUsed: new Date()
            });
        }

        return cached;
    },

    async saveAnswer(question, answer, sources, confidence) {
        return await KnowledgeCache.findOneAndUpdate(
            { question },
            {
                answer,
                sources,
                confidence,
                lastUsed: new Date(),
                expiresAt: new Date(+new Date() + 7 * 24 * 60 * 60 * 1000)
            },
            { upsert: true, new: true }
        );
    },

    async cleanExpired() {
        return await KnowledgeCache.deleteMany({
            expiresAt: { $lt: new Date() }
        });
    }
};

// Analytics Management
export const AnalyticsRepository = {
    async recordDailyMetrics() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const metrics = await Message.aggregate([
            {
                $match: {
                    timestamp: {
                        $gte: today,
                        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    totalMessages: { $sum: 1 },
                    avgConfidence: { $avg: '$metadata.confidence' },
                    avgResponseTime: { $avg: '$metadata.responseTime' }
                }
            }
        ]);

        // Save or update today's analytics
        return await Analytics.findOneAndUpdate(
            { date: today },
            { $set: { metrics: metrics[0] || {} } },
            { upsert: true, new: true }
        );
    },

    async getMetrics(days = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return await Analytics.find({
            date: { $gte: startDate }
        }).sort({ date: -1 });
    }
};