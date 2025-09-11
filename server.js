// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { ChatOpenAI } from '@langchain/openai';
import { RetrievalQAChain } from 'langchain/chains';
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { Document } from 'langchain/document';
import * as fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { detect } from 'langdetect';
import { postEscalationMessage, startSlackBot } from './slackBot.js';


// Initialize environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Global variables to store our vector store and QA chain
let qaChain = null;
let vectorStore = null;
let isInitialized = false;

// Initialize the documentation system
async function initializeDocumentationSystem() {
    try {
        console.log('🚀 Initializing documentation system...');

        // Initialize OpenAI embeddings
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        // Initialize the LLM with better multilingual support
        const model = new ChatOpenAI({
            openAIApiKey: process.env.OPENAI_API_KEY,
            temperature: 0.3,
            modelName: 'gpt-3.5-turbo',
        });

        // Create vector store (in production, use Pinecone, Weaviate, or similar)
        vectorStore = new MemoryVectorStore(embeddings);

        // Load documentation from multiple sources
        const documents = await loadDocuments();

        // Split documents into chunks
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const splitDocs = await textSplitter.splitDocuments(documents);
        console.log(`📄 Split into ${splitDocs.length} chunks`);

        // Add documents to vector store
        await vectorStore.addDocuments(splitDocs);
        console.log('✅ Documents added to vector store');

        // Create the QA chain
        qaChain = RetrievalQAChain.fromLLM(
            model,
            vectorStore.asRetriever({
                k: 4, // Number of documents to retrieve
            }),
            {
                returnSourceDocuments: true,
            }
        );

        isInitialized = true;
        console.log('✅ Documentation system initialized successfully!');

    } catch (error) {
        console.error('❌ Error initializing documentation system:', error);
        throw error;
    }
}

// Function to load documents from various sources
async function loadDocuments() {
    const documents = [];

    // 1. Load from TransFi documentation website
    try {
        console.log('📥 Loading TransFi documentation...');
        const loader = new CheerioWebBaseLoader(
            'https://docs.transfi.com/docs/welcome-to-transfi-developer-hub'
        );

        const webDocs = await loader.load();
        documents.push(...webDocs);
        console.log(`✅ Loaded ${webDocs.length} web documents`);
    } catch (error) {
        console.error('⚠️ Error loading web documentation:', error.message);
    }

    // 2. Load FAQ PDF from data folder
    const faqPdfPath = path.join(__dirname, 'data', 'faq.pdf');
    try {
        await fs.access(faqPdfPath);
        console.log('📥 Loading FAQ PDF...');
        const loader = new PDFLoader(faqPdfPath);
        const faqDocs = await loader.load();
        documents.push(...faqDocs);
        console.log(`✅ Loaded FAQ PDF: ${faqDocs.length} pages`);
    } catch (error) {
        console.log('ℹ️ FAQ PDF not found in data folder, skipping FAQ loading');
    }

    // 3. Load other PDF files if documents/pdfs directory exists
    const pdfDir = path.join(__dirname, 'documents', 'pdfs');
    try {
        await fs.access(pdfDir);
        const pdfFiles = await fs.readdir(pdfDir);

        for (const file of pdfFiles) {
            if (file.endsWith('.pdf')) {
                const pdfPath = path.join(pdfDir, file);
                const loader = new PDFLoader(pdfPath);
                const pdfDocs = await loader.load();
                documents.push(...pdfDocs);
                console.log(`✅ Loaded PDF: ${file}`);
            }
        }
    } catch (error) {
        console.log('ℹ️ No additional PDF directory found, skipping additional PDF loading');
    }

    // 4. Load local markdown or text files
    const mdDir = path.join(__dirname, 'documents', 'markdown');
    try {
        await fs.access(mdDir);
        const mdFiles = await fs.readdir(mdDir);

        for (const file of mdFiles) {
            if (file.endsWith('.md') || file.endsWith('.txt')) {
                const filePath = path.join(mdDir, file);
                const content = await fs.readFile(filePath, 'utf-8');
                documents.push(
                    new Document({
                        pageContent: content,
                        metadata: { source: filePath },
                    })
                );
                console.log(`✅ Loaded markdown/text: ${file}`);
            }
        }
    } catch (error) {
        console.log('ℹ️ No markdown directory found, skipping markdown loading');
    }

    // 5. Add some default TransFi documentation if no documents loaded
    if (documents.length === 0) {
        console.log('📝 Adding default documentation...');
        documents.push(
            new Document({
                pageContent: `
                    TransFi API Documentation
                    
                    Authentication:
                    TransFi uses OAuth 2.0 and API key authentication. To authenticate:
                    1. Register your application in the TransFi dashboard
                    2. Obtain your API key and secret
                    3. Include the API key in the Authorization header: "Bearer YOUR_API_KEY"
                    
                    Base URL: https://api.transfi.com/v1
                    
                    Payment Methods:
                    - ACH Transfers: 1-3 business days processing
                    - Wire Transfers: Same-day processing available
                    - Credit/Debit Cards: Instant processing
                    - Digital Wallets: Instant processing
                    
                    Webhooks:
                    Configure webhooks in your dashboard to receive real-time notifications.
                    Webhook events include: payment.created, payment.completed, payment.failed
                    
                    Error Codes:
                    - 400: Bad Request - Invalid parameters
                    - 401: Unauthorized - Invalid or missing API key
                    - 404: Not Found - Resource doesn't exist
                    - 429: Too Many Requests - Rate limit exceeded
                    - 500: Internal Server Error
                `,
                metadata: { source: 'default-docs' },
            })
        );
    }

    return documents;
}

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        initialized: isInitialized,
        timestamp: new Date().toISOString()
    });
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { question } = req.body;

        if (!question) {
            return res.status(400).json({
                error: 'Question is required'
            });
        }

        if (!isInitialized) {
            return res.status(503).json({
                error: 'System is still initializing. Please try again in a moment.'
            });
        }

        console.log(`💬 Received question: ${question}`);

        // Automatically detect language using langdetect
        let detectedLanguage = 'en'; // default to English
        let languageName = 'English';

        try {
            const detected = detect(question);
            if (detected && detected.length > 0) {
                detectedLanguage = detected[0].lang;

                // Map language codes to human-readable names
                const languageMap = {
                    'en': 'English',
                    'bn': 'Bengali/Bangla',
                    'es': 'Spanish',
                    'zh': 'Chinese',
                    'ar': 'Arabic',
                    'hi': 'Hindi',
                    'tl': 'Filipino/Tagalog',
                    'fr': 'French',
                    'de': 'German',
                    'it': 'Italian',
                    'pt': 'Portuguese',
                    'ru': 'Russian',
                    'ja': 'Japanese',
                    'ko': 'Korean',
                    'th': 'Thai',
                    'vi': 'Vietnamese',
                    'id': 'Indonesian',
                    'ms': 'Malay',
                    'sw': 'Swahili',          // East Africa (Kenya, Tanzania, Uganda)
                    'ha': 'Hausa',            // West Africa (Nigeria, Niger, Ghana)
                    'yo': 'Yoruba',           // West Africa (Nigeria, Benin)
                    'ig': 'Igbo',             // West Africa (Nigeria)
                    'am': 'Amharic',          // East Africa (Ethiopia)
                    'zu': 'Zulu',             // Southern Africa (South Africa)
                    'xh': 'Xhosa',            // Southern Africa (South Africa)
                    'af': 'Afrikaans',        // Southern Africa (South Africa)
                    'so': 'Somali',           // East Africa (Somalia, Ethiopia, Kenya)
                    'rw': 'Kinyarwanda',      // East Africa (Rwanda, Uganda)
                    'lg': 'Luganda',          // East Africa (Uganda)
                    'om': 'Oromo',            // East Africa (Ethiopia)
                    'ti': 'Tigrinya',         // East Africa (Ethiopia, Eritrea)
                    'sn': 'Shona',            // Southern Africa (Zimbabwe)
                    'wo': 'Wolof'             // West Africa (Senegal, Gambia)
                };

                languageName = languageMap[detectedLanguage] || detectedLanguage.toUpperCase();
            }
        } catch (error) {
            console.log('⚠️ Language detection failed, defaulting to English:', error.message);
        }

        // Create dynamic language instruction
        const languageInstruction = detectedLanguage === 'en'
            ? 'Respond in English. '
            : `You must respond only in ${languageName} language. Do not use English or any other language. `;

        const enhancedQuery = languageInstruction + question;
        console.log(`🌐 Detected language: ${detectedLanguage}`);

        // Get answer from QA chain
        const response = await qaChain.call({
            query: enhancedQuery,
        });

        // Human intervention for low-confidence answer
        const lowConfidencePhrases = [
            "I don't know.",
            "I don't have that information.",
            "I'm not sure.",
            "Sorry, I don't know.",
            "I do not know.",
            "I do not have that information.",
            "I'm sorry, I don't know.",
            "I'm sorry, I do not know."
        ];

        if (
            !response.text ||
            lowConfidencePhrases.some(phrase =>
                response.text.toLowerCase().includes(phrase.toLowerCase())
            )
        ) {
            const thread_ts = await postEscalationMessage(question);
            return res.json({
                answer: "AI couldn't answer. A human assistant will reply shortly.",
                escalation: true,
                thread_ts
            });
        }

        // Extract sources with FAQ prioritization
        const sources = response.sourceDocuments?.map(doc => {
            const source = doc.metadata?.source || 'TransFi Documentation';
            const isFAQ = source.includes('faq.pdf');
            return {
                content: doc.pageContent.substring(0, 200) + '...',
                source: isFAQ ? '📋 FAQ Document' : source,
                type: isFAQ ? 'faq' : 'documentation'
            };
        }) || [];

        // Sort sources to prioritize FAQ content
        sources.sort((a, b) => {
            if (a.type === 'faq' && b.type !== 'faq') return -1;
            if (a.type !== 'faq' && b.type === 'faq') return 1;
            return 0;
        });

        console.log(`✅ Generated answer with ${sources.length} sources`);

        res.json({
            answer: response.text,
            sources: sources,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error processing question:', error);
        const thread_ts = await postEscalationMessage(req.body.question || "Unknown Question");
        res.status(500).json({
            answer: "Connecting you to a human assistant...",
            escalation: true,
            thread_ts
        });
    }
});

// Endpoint to add new documents dynamically
app.post('/api/documents', async (req, res) => {
    try {
        const { content, source } = req.body;

        if (!content) {
            return res.status(400).json({
                error: 'Content is required'
            });
        }

        const document = new Document({
            pageContent: content,
            metadata: { source: source || 'user-upload' },
        });

        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const splitDocs = await textSplitter.splitDocuments([document]);
        await vectorStore.addDocuments(splitDocs);

        res.json({
            message: 'Document added successfully',
            chunks: splitDocs.length
        });

    } catch (error) {
        console.error('❌ Error adding document:', error);
        res.status(500).json({
            error: 'Failed to add document'
        });
    }
});

// Endpoint to search similar documents
app.post('/api/search', async (req, res) => {
    try {
        const { query, limit = 5 } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Query is required'
            });
        }

        if (!isInitialized) {
            return res.status(503).json({
                error: 'System is still initializing'
            });
        }

        const results = await vectorStore.similaritySearch(query, limit);

        res.json({
            results: results.map(doc => ({
                content: doc.pageContent,
                source: doc.metadata?.source || 'Unknown'
            }))
        });

    } catch (error) {
        console.error('❌ Error searching documents:', error);
        res.status(500).json({
            error: 'Failed to search documents'
        });
    }
});

// Start server
app.listen(PORT, async () => {
    console.log(`🌐 Server running on http://localhost:${PORT}`);
    console.log('📚 Initializing documentation system...');

    try {
        await initializeDocumentationSystem();
        await startSlackBot();
    } catch (error) {
        console.error('Failed to initialize:', error);
        console.log('⚠️ Server is running but documentation system failed to initialize');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    process.exit(0);
});
