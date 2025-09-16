// models/database.js - MongoDB Schema and Connection
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongooseOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
};
// Connect to MongoDB
export async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/transfi-chatbot', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        mongoose.nucleus = await mongoose.createConnection(
            process.env.MONGODB_URI_NUCLEUS,
            mongooseOptions,
        );
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

// Human Learning Schema - Stores Q&A pairs from human interventions
const HumanLearningSchema = new mongoose.Schema({
    originalQuestion: {
        type: String,
        required: true,
        index: true
    },
    humanAnswer: {
        type: String,
        required: true
    },
    sessionId: {
        type: String,
        required: true
    },
    threadTs: String, // Slack thread timestamp
    humanAgent: {
        slackUserId: String,
        agentName: String
    },
    confidence: {
        type: Number,
        default: 1.0 // Human answers have high confidence
    },
    usageCount: {
        type: Number,
        default: 0
    },
    lastUsed: Date,
    isActive: {
        type: Boolean,
        default: true
    },
    tags: [String], // For categorization
    language: String, // Detected language of the question
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Create indexes for better performance
MessageSchema.index({ sessionId: 1, timestamp: -1 });
MessageSchema.index({ 'metadata.threadTs': 1 });
EscalationSchema.index({ status: 1, createdAt: -1 });
KnowledgeCacheSchema.index({ question: 'text' });
HumanLearningSchema.index({ originalQuestion: 'text' });
HumanLearningSchema.index({ isActive: 1, usageCount: -1 });

// Create models
export const Session = mongoose.model('Session', SessionSchema);
export const Message = mongoose.model('Message', MessageSchema);
export const Escalation = mongoose.model('Escalation', EscalationSchema);
export const Analytics = mongoose.model('Analytics', AnalyticsSchema);
export const KnowledgeCache = mongoose.model('KnowledgeCache', KnowledgeCacheSchema);
export const Feedback = mongoose.model('Feedback', FeedbackSchema);
export const HumanLearning = mongoose.model('HumanLearning', HumanLearningSchema);

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

// Human Learning Management
export const HumanLearningRepository = {
    async saveQAPair(originalQuestion, humanAnswer, sessionId, threadTs, humanAgent, language = 'en', embeddings = null) {
        // Check if similar Q&A already exists
        const existing = await HumanLearning.findOne({
            originalQuestion,
            isActive: true
        });

        let questionEmbedding = null;
        if (embeddings) {
            try {
                console.log('🧮 Generating embedding for question...');
                questionEmbedding = await embeddings.embedQuery(originalQuestion);
                console.log('✅ Embedding generated successfully');
            } catch (error) {
                console.error('❌ Error generating embedding:', error);
            }
        }

        if (existing) {
            // Update existing answer if newer
            const updateData = {
                humanAnswer,
                humanAgent,
                updatedAt: new Date()
            };

            // Add embedding if generated
            if (questionEmbedding) {
                updateData.questionEmbedding = questionEmbedding;
            }

            return await HumanLearning.findByIdAndUpdate(existing._id, updateData, { new: true });
        }

        // Create new Q&A pair
        const qaPairData = {
            originalQuestion,
            humanAnswer,
            sessionId,
            threadTs,
            humanAgent,
            language
        };

        // Add embedding if generated
        if (questionEmbedding) {
            qaPairData.questionEmbedding = questionEmbedding;
        }

        const qaPair = new HumanLearning(qaPairData);
        const savedPair = await qaPair.save();

        // Also save to markdown file for AI training
        try {
            await this.updateMarkdownFile();
            console.log('📝 Markdown file updated with new Q&A pair');
        } catch (error) {
            console.error('❌ Error updating markdown file:', error);
        }

        return savedPair;
    },

    async findSimilarAnswer(question, embeddings = null) {
        // First try exact match
        let match = await HumanLearning.findOne({
            originalQuestion: question,
            isActive: true
        });

        if (match) {
            console.log('🎯 Found exact match for question');
            // Update usage stats
            await HumanLearning.findByIdAndUpdate(match._id, {
                $inc: { usageCount: 1 },
                lastUsed: new Date()
            });
            return match;
        }

        // If embeddings provided, use semantic similarity
        if (embeddings) {
            try {
                console.log('🔍 Searching for semantically similar questions...');
                const questionEmbedding = await embeddings.embedQuery(question);

                // Get all active Q&A pairs with embeddings
                const allQAs = await HumanLearning.find({
                    isActive: true,
                    questionEmbedding: { $exists: true, $ne: null }
                });

                let bestMatch = null;
                let bestSimilarity = 0;
                const SIMILARITY_THRESHOLD = 0.82; // Increased threshold for higher precision

                console.log(`🎯 Comparing against ${allQAs.length} stored Q&A pairs with threshold ${SIMILARITY_THRESHOLD}`);

                for (const qa of allQAs) {
                    if (qa.questionEmbedding && qa.questionEmbedding.length > 0) {
                        const similarity = this.calculateCosineSimilarity(questionEmbedding, qa.questionEmbedding);
                        console.log(`📊 Similarity between "${question}" and "${qa.originalQuestion}": ${similarity.toFixed(3)}`);

                        if (similarity > bestSimilarity && similarity >= SIMILARITY_THRESHOLD) {
                            bestSimilarity = similarity;
                            bestMatch = qa;
                        }
                    }
                }

                if (bestMatch) {
                    console.log(`✅ Found semantic match with similarity ${bestSimilarity.toFixed(3)}: "${bestMatch.originalQuestion}"`);
                    // Update usage stats
                    await HumanLearning.findByIdAndUpdate(bestMatch._id, {
                        $inc: { usageCount: 1 },
                        lastUsed: new Date()
                    });
                    return bestMatch;
                } else {
                    console.log(`❌ No semantic match found above threshold ${SIMILARITY_THRESHOLD}`);
                    console.log('🚫 NOT falling back to text search - maintaining answer quality');
                }
            } catch (error) {
                console.error('Error in semantic search:', error);
            }
        } else {
            console.log('⚠️ No embeddings provided - cannot perform semantic matching');
        }

        // NO FALLBACK - Return null if no high-quality semantic match found
        console.log('🎯 No human-learned answer found - will proceed to AI/escalation');
        return null;
    },

    // Helper function to calculate cosine similarity
    calculateCosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA === 0 || normB === 0) return 0;

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    },

    async getTopAnswers(limit = 10) {
        return await HumanLearning.find({ isActive: true })
            .sort({ usageCount: -1, createdAt: -1 })
            .limit(limit)
            .lean();
    },

    async deactivateAnswer(id) {
        return await HumanLearning.findByIdAndUpdate(id, {
            isActive: false,
            updatedAt: new Date()
        });
    },

    async getStats() {
        return await HumanLearning.aggregate([
            { $match: { isActive: true } },
            {
                $group: {
                    _id: null,
                    totalQAs: { $sum: 1 },
                    totalUsage: { $sum: '$usageCount' },
                    avgUsage: { $avg: '$usageCount' },
                    languages: { $addToSet: '$language' }
                }
            }
        ]);
    },

    async updateMarkdownFile() {
        const fs = await import('fs/promises');
        const path = await import('path');
        const { fileURLToPath } = await import('url');

        // Get all active Q&A pairs
        const qaPairs = await HumanLearning.find({ isActive: true })
            .sort({ createdAt: -1 })
            .lean();

        // Generate markdown content
        let markdownContent = `# Human-Learned Q&A Knowledge Base

This document contains questions and answers that were provided by human agents when the AI couldn't answer user queries. This knowledge base helps the AI provide better responses in the future.

**Last Updated:** ${new Date().toISOString()}
**Total Q&A Pairs:** ${qaPairs.length}

---

`;

        // Group by language
        const qaPairsByLanguage = {};
        qaPairs.forEach(qa => {
            const lang = qa.language || 'en';
            if (!qaPairsByLanguage[lang]) {
                qaPairsByLanguage[lang] = [];
            }
            qaPairsByLanguage[lang].push(qa);
        });

        // Generate content for each language
        Object.entries(qaPairsByLanguage).forEach(([language, pairs]) => {
            const languageNames = {
                'en': 'English',
                'bn': 'Bengali/Bangla',
                'es': 'Spanish',
                'fr': 'French',
                'de': 'German'
            };

            markdownContent += `## ${languageNames[language] || language.toUpperCase()} Questions\n\n`;

            pairs.forEach((qa, index) => {
                markdownContent += `### Q${index + 1}: ${qa.originalQuestion}\n\n`;
                markdownContent += `**Answer:** ${qa.humanAnswer}\n\n`;
                markdownContent += `**Usage Count:** ${qa.usageCount}\n`;
                markdownContent += `**Date Added:** ${qa.createdAt.toISOString().split('T')[0]}\n\n`;
                markdownContent += `---\n\n`;
            });
        });

        // Add footer
        markdownContent += `
## Notes

- This knowledge base is automatically generated from human agent interactions
- Questions are matched using AI embeddings for semantic similarity
- High usage count indicates frequently asked questions
- This file is used as a source document for the AI system

`;

        // Write to data folder
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const dataDir = path.join(__dirname, '..', 'data');
            const filePath = path.join(dataDir, 'human-learned-qa.md');

            // Ensure data directory exists
            await fs.mkdir(dataDir, { recursive: true });

            // Write the file
            await fs.writeFile(filePath, markdownContent, 'utf-8');
            console.log(`📄 Markdown file written to: ${filePath}`);

            return filePath;
        } catch (error) {
            console.error('Error writing markdown file:', error);
            throw error;
        }
    }
};