// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { OpenAI } from '@langchain/openai';
import { RetrievalQAChain } from 'langchain/chains';
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { Document } from 'langchain/document';
import * as fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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

        // Initialize the LLM
        const model = new OpenAI({
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

        // Create the QA chain
        qaChain = RetrievalQAChain.fromLLM(
            model,
            vectorStore.asRetriever(),
            {
                returnSourceDocuments: true,
                k: 4, // Number of documents to retrieve
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

    // 2. Load local PDF files if they exist
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
        console.log('ℹ️ No PDF directory found, skipping PDF loading');
    }

    // 3. Load local markdown or text files
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

    // 4. Add some default TransFi documentation if no documents loaded
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

        // Get answer from QA chain
        const response = await qaChain.call({
            query: question,
        });

        // Extract sources
        const sources = response.sourceDocuments?.map(doc => ({
            content: doc.pageContent.substring(0, 200) + '...',
            source: doc.metadata?.source || 'TransFi Documentation'
        })) || [];

        console.log(`✅ Generated answer with ${sources.length} sources`);

        res.json({
            answer: response.text,
            sources: sources,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error processing question:', error);
        res.status(500).json({
            error: 'Failed to process your question. Please try again.'
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