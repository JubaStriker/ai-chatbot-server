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
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import { postEscalationMessage, startSlackBot, getConnectionStatus } from './slackBot.js';
import { v4 as uuidv4 } from 'uuid';
import { analyzeOrderQuery } from './helpers/orderDetection.js';

// MongoDB imports
import {
    connectDB,
    SessionRepository,
    MessageRepository,
    EscalationRepository,
    KnowledgeCacheRepository,
    AnalyticsRepository,
    HumanLearningRepository
} from './models/database.js';
import { error } from 'console';
// Order model will be imported dynamically when needed

// Initialize environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

app.use(async (req, res, next) => {
    let sessionId = req.headers['x-session-id'] || req.query.sessionId;

    if (!sessionId) {
        sessionId = uuidv4();
        res.setHeader('X-Session-Id', sessionId);
    }

    req.sessionId = sessionId;

    // Get or create session in MongoDB
    try {
        let session = await SessionRepository.findById(sessionId);
        if (!session) {
            // Extract user info from request
            const userInfo = {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                // Add more user info if available
            };
            session = await SessionRepository.create(sessionId, userInfo);
            console.log(`📝 New session created: ${sessionId}`);
        } else {
            // Update last activity
            await SessionRepository.updateActivity(sessionId);
        }
        req.session = session;
    } catch (error) {
        console.error('Session error:', error);
    }

    next();
});

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
            modelName: 'gpt-4-turbo',
        });

        // Create vector store (in production, use Pinecone, Weaviate, or similar)
        vectorStore = new MemoryVectorStore(embeddings);

        // Load documentation from multiple sources
        const documents = await loadDocuments();

        // Split documents into chunks with better overlap for comprehensive coverage
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1500,        // Increased chunk size for more context
            chunkOverlap: 400,      // Increased overlap to ensure no data is missed
            separators: ['\n\n', '\n', '. ', ' ', ''], // Better separation strategy
        });

        const splitDocs = await textSplitter.splitDocuments(documents);
        console.log(`📄 Split into ${splitDocs.length} chunks with improved overlap strategy`);

        // Add documents to vector store
        await vectorStore.addDocuments(splitDocs);
        console.log('✅ Documents added to vector store');

        // Create the QA chain with improved retrieval
        qaChain = RetrievalQAChain.fromLLM(
            model,
            vectorStore.asRetriever({
                k: 8,           // Increased from 4 to 8 for more comprehensive search
                searchType: "similarity",
                searchKwargs: {
                    fetchK: 20,  // Fetch more candidates before filtering
                }
            }),
            {
                returnSourceDocuments: true,
                chainType: "stuff", // Ensures all retrieved docs are considered
            }
        );

        isInitialized = true;
        console.log('✅ Documentation system initialized successfully!');

    } catch (error) {
        console.error('❌ Error initializing documentation system:', error);
        throw error;
    }
}

// Helper function to process CSV files
async function processCSVFile(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        let headers = [];

        createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                if (headers.length === 0) {
                    headers = Object.keys(data);
                    console.log(`📊 CSV Headers: ${headers.join(', ')}`);
                }
                results.push(data);
            })
            .on('end', () => {
                // Convert CSV data to readable text format
                let content = `CSV Data from ${path.basename(filePath)}:\n\n`;

                // Add headers description
                content += `Columns: ${headers.join(', ')}\n\n`;

                // Convert each row to readable format with better structure
                results.forEach((row, index) => {
                    const rowValues = Object.values(row).filter(val => val && val.toString().trim());
                    if (rowValues.length > 0) {
                        content += `Entry ${index + 1}:\n`;
                        Object.entries(row).forEach(([key, value]) => {
                            if (value && value.toString().trim()) {
                                content += `${key}: ${value}\n`;
                            }
                        });

                        // Add searchable summary for this row
                        const summary = Object.entries(row)
                            .filter(([key, value]) => value && value.toString().trim())
                            .map(([key, value]) => `${key}=${value}`)
                            .join(', ');
                        content += `Summary: ${summary}\n`;
                        content += '---\n';
                    }
                });

                resolve(content);
            })
            .on('error', reject);
    });
}

// Helper function to process XLSX files
async function processXLSXFile(filePath) {
    try {
        console.log(`📈 Processing XLSX file: ${filePath}`);

        // Dynamic import for XLSX to handle ES module issues
        const { default: XLSXLib } = await import('xlsx');
        console.log(`📈 XLSX imported:`, typeof XLSXLib, Object.keys(XLSXLib));

        const workbook = XLSXLib.readFile(filePath);
        let content = `Excel Data from ${path.basename(filePath)}:\n\n`;

        // Process each sheet
        workbook.SheetNames.forEach((sheetName, sheetIndex) => {
            content += `Sheet: ${sheetName}\n`;
            content += '='.repeat(40) + '\n';

            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSXLib.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length > 0) {
                // First row as headers
                const headers = jsonData[0];
                content += `Columns: ${headers.join(', ')}\n\n`;

                // Process data rows with better structure
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row.some(cell => cell !== undefined && cell !== '')) {
                        content += `Entry ${i}:\n`;
                        const rowData = [];
                        headers.forEach((header, colIndex) => {
                            const value = row[colIndex];
                            if (value !== undefined && value !== '') {
                                content += `${header}: ${value}\n`;
                                rowData.push(`${header}=${value}`);
                            }
                        });

                        // Add searchable summary for this row
                        if (rowData.length > 0) {
                            content += `Summary: ${rowData.join(', ')}\n`;
                        }
                        content += '---\n';
                    }
                }
            }
            content += '\n';
        });

        return content;
    } catch (error) {
        console.error(`Error processing XLSX file ${filePath}:`, error);
        throw error;
    }
}

// Function to load documents from various sources
async function loadDocuments() {
    const documents = [];

    // 1. Load from TransFi documentation website
    const urls = [
        'https://www.transfi.com/help-center-articles/how-can-a-business-start-with-transfi#help',
        'https://www.transfi.com/help-center-articles/i-have-successful-payments-in-my-account-how-can-i-withdraw-the-funds#help',
        'https://www.transfi.com/help-center-articles/what-is-meant-by-prefunding-am-i-sending-funds-to-transfi-first#help',
        'https://www.transfi.com/help-center-articles/how-can-i-get-a-wallet-address#help',
        'https://www.transfi.com/help-center-articles/what-is-the-kyb-process---what-is-transfi-kyb-process',
        'https://www.transfi.com/help-center-articles/how-do-i-request-an-account-statement-what-are-the-functions-of-transfis-dashboard#help',
        'https://www.transfi.com/help-center-articles/are-there-transaction-limits#help',
        'https://www.transfi.com/help-center-articles/how-long-does-it-take-for-a-local-currency-payout-to-be-received-by-the-beneficiary#help',
        'https://www.transfi.com/help-center-articles/which-currencies-and-digital-assets-are-supported-in-collections-product#help',
        'https://www.transfi.com/help-center-articles/is-kyc-mandatory-for-my-customers#help'
    ];

    console.log(`📥 Loading ${urls.length} TransFi documentation URLs...`);

    for (const url of urls) {
        try {
            console.log(`Loading: ${url}`);
            const loader = new CheerioWebBaseLoader(url);
            const webDocs = await loader.load();
            documents.push(...webDocs);
            console.log(`✅ Loaded ${webDocs.length} documents from ${url}`);
        } catch (error) {
            console.error(`⚠️ Error loading ${url}:`, error.message);
        }
    }

    // 2. Load all PDF, CSV, and XLSX files from data folder
    const dataDir = path.join(__dirname, 'data');
    try {
        await fs.access(dataDir);
        const dataFiles = await fs.readdir(dataDir);
        for (const file of dataFiles) {
            const filePath = path.join(dataDir, file);

            if (file.endsWith('.pdf')) {
                try {
                    const loader = new PDFLoader(filePath);
                    const pdfDocs = await loader.load();
                    documents.push(...pdfDocs);
                    console.log(`✅ Loaded PDF from data: ${file} (${pdfDocs.length} pages)`);
                } catch (error) {
                    console.error(`⚠️ Error loading PDF ${file}:`, error.message);
                }
            } else if (file.endsWith('.csv')) {
                try {
                    const csvContent = await processCSVFile(filePath);
                    documents.push(
                        new Document({
                            pageContent: csvContent,
                            metadata: { source: `data/${file}`, type: 'csv' },
                        })
                    );
                    console.log(`✅ Loaded CSV from data: ${file}`);
                } catch (error) {
                    console.error(`⚠️ Error loading CSV ${file}:`, error.message);
                }
            } else if (file.endsWith('.xlsx') || file.endsWith('.xls')) {
                try {
                    const xlsxContent = await processXLSXFile(filePath);
                    documents.push(
                        new Document({
                            pageContent: xlsxContent,
                            metadata: { source: `data/${file}`, type: 'xlsx' },
                        })
                    );
                    console.log(`✅ Loaded Excel from data: ${file}`);
                } catch (error) {
                    console.error(`⚠️ Error loading Excel ${file}:`, error.message);
                }
            }
        }
    } catch (error) {
        console.log('ℹ️ Data folder not found, skipping file loading from data');
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

// Debug endpoint for connection status
app.get('/api/debug/connections', (req, res) => {
    try {
        const status = getConnectionStatus();
        res.json(status);
    } catch (error) {
        console.error('Error getting connection status:', error);
        res.status(500).json({ error: 'Failed to get connection status' });
    }
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    try {
        const { question } = req.body;
        const sessionId = req.sessionId;

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


        console.log(`💬 Session ${sessionId} asked: ${question}`);

        // Analyze if this is an order/transaction related query
        const orderAnalysis = analyzeOrderQuery(question);

        // Save user message to MongoDB with enhanced metadata
        const userMessage = await MessageRepository.create({
            sessionId,
            messageId: uuidv4(),
            sender: 'user',
            content: { text: question },
            metadata: {
                intent: detectIntent(question),
                sentiment: 'neutral',
                orderAnalysis: orderAnalysis, // Store order analysis
                isOrderRelated: orderAnalysis.isOrderRelated,
                extractedOrderIds: orderAnalysis.orderIdExtraction.orderIds,
                urgency: orderAnalysis.analysis.urgency
            }
        });

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

        // First check if there's a human-answered version
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
        });
        const humanAnswer = await HumanLearningRepository.findSimilarAnswer(question, embeddings);
        if (humanAnswer) {
            console.log('🧑 Using human-learned answer');

            // Save bot response to MongoDB
            const botMessage = await MessageRepository.create({
                sessionId,
                messageId: uuidv4(),
                sender: 'bot',
                senderInfo: { model: 'human-learned' },
                content: { text: humanAnswer.humanAnswer },
                metadata: {
                    sources: [{ content: 'Human agent answer', source: 'Human Learning Database' }],
                    confidence: humanAnswer.confidence,
                    responseTime: Date.now() - startTime,
                    isEscalated: false,
                    learnedFrom: humanAnswer._id
                }
            });

            return res.json({
                answer: humanAnswer.humanAnswer,
                sources: [{ content: 'Previously answered by human agent', source: 'Human Learning Database', type: 'human_learned' }],
                sessionId,
                messageId: botMessage.messageId,
                type: 'human_learned_response',
                timestamp: new Date().toISOString()
            });
        }

        // Then check regular cache
        const cachedAnswer = await KnowledgeCacheRepository.findAnswer(question);
        if (cachedAnswer && cachedAnswer.confidence > 0.8) {
            console.log('📦 Using cached answer');

            // Save bot response to MongoDB
            const botMessage = await MessageRepository.create({
                sessionId,
                messageId: uuidv4(),
                sender: 'bot',
                senderInfo: { model: 'cache' },
                content: { text: cachedAnswer.answer },
                metadata: {
                    sources: cachedAnswer.sources,
                    confidence: cachedAnswer.confidence,
                    responseTime: Date.now() - startTime,
                    isEscalated: false
                }
            });

            return res.json({
                answer: cachedAnswer.answer,
                sources: cachedAnswer.sources,
                sessionId,
                messageId: botMessage.messageId,
                type: 'cached_response',
                timestamp: new Date().toISOString()
            });
        }

        // Create dynamic language instruction
        const languageInstruction = detectedLanguage === 'en'
            ? 'Respond in English. '
            : `You must respond only in ${languageName} language. Do not use English or any other language. `;

        const enhancedQuery = languageInstruction + question;
        console.log(`🌐 Detected language: ${detectedLanguage}`);

        // Handle order-specific queries with special logic
        if (orderAnalysis.isOrderRelated && orderAnalysis.orderIdExtraction.found) {
            console.log('📋 Detected order-specific query with Order ID(s)');

            // If order IDs are found, this likely needs human intervention for lookup
            if (orderAnalysis.recommendedAction === 'escalate_with_order_id') {
                console.log('⚠️ Order issue detected - escalating with order ID context');
                const orderContext = `Order IDs found: ${orderAnalysis.orderIdExtraction.orderIds.join(', ')}`;

            }
        }

        // Enhanced search strategy - first get relevant documents directly
        console.log('🔍 Performing enhanced document search...');
        const relevantDocs = await vectorStore.similaritySearch(question, 20); // Get more docs
        console.log(`📄 Found ${relevantDocs.length} potentially relevant document chunks`);

        // Enhance query based on order analysis
        let contextualQuery = enhancedQuery;
        if (orderAnalysis.isOrderRelated) {
            console.log(orderAnalysis);
            const { orderIds = [] } = orderAnalysis.orderIdExtraction;
            let orderData = [];
            try {
                const { Order } = await import('./models/order.js');
                orderData = await Order.find({ orderId: { $in: orderIds } }).select({
                    orderId: 1,
                    cryptoAmount: 1,
                    cryptoTicker: 1,
                    cryptoUnitPrice: 1,
                    fiat: 1,
                    status: 1,
                    paymentType: 1,
                    recipientName: 1,
                    timestamps: 1,
                    type: 1,
                    fiatAmount: 1,
                    fiatTicker: 1,
                    userId: 1,
                    error: 1
                }).lean();
                console.log(`📋 Found ${orderData.length} orders in database for IDs: ${orderIds.join(', ')}`);
                console.log('Querying Order IDs:', { orderId: { $in: orderIds } });
            } catch (error) {
                console.error('❌ Error fetching order data:', error);
                orderData = [];
            }

            console.log(`📋 Order data:`, orderData[0]);

            contextualQuery += `You are a helpful assistant. I will give you transaction/order data in JSON format. 
                                Your job is to analyze it and explain it in simple English for an end-user who doesn’t know JSON or technical details. 

                                - Do not mention JSON, code, or technical terms. 
                                - Summarize the important details like: 
                                • What type of transaction it was (buy/sell crypto, payment, etc.)  
                                • Currency, amounts, and exchange rate   
                                • Payment method  
                                • Status of the transaction (success, failed, pending)  
                                • Timing (when it started, failed, or completed)  
                                - Keep the answer short, clear, and easy to understand. 
                                - Present it like a transaction overall status. 
                                - If there are any issues (failed, pending), explain what that means and possible next steps.
                                - If the order status if fund_failed/assest_failed tell the user that, he can raise a support ticket with the error code for more details using this link https://transfi-customersupport.freshdesk.com/support/tickets/new, also highlight this link for good visibility.
                                

                                Here is the data: ${JSON.stringify(orderData[0])})`;
        }

        // Get answer from QA chain with enhanced query
        const response = await qaChain.call({
            query: contextualQuery,
        });

        // Log what documents were actually used
        console.log('📋 Documents used in response:');
        response.sourceDocuments?.forEach((doc, index) => {
            const source = doc.metadata?.source || 'Unknown';
            const preview = doc.pageContent.substring(0, 100) + '...';
            console.log(`  ${index + 1}. ${source}: ${preview}`);
        });

        // Improved confidence calculation based on multiple factors
        let confidence = 0.3; // Base confidence

        if (response.text && response.text.length > 20) {
            confidence += 0.2; // Has substantial response
        }

        if (response.sourceDocuments && response.sourceDocuments.length > 0) {
            confidence += 0.3; // Has source documents
        }

        if (response.sourceDocuments && response.sourceDocuments.length >= 3) {
            confidence += 0.2; // Has multiple sources (more reliable)
        }

        // Check if response contains specific, factual information
        const hasSpecificInfo = /\b(yes|no|prohibited|allowed|supported|available|USD|EUR|GBP|\d+|\$|%)\b/i.test(response.text);
        if (hasSpecificInfo) {
            confidence += 0.2;
        }

        console.log(`📊 Calculated confidence: ${confidence.toFixed(2)}`);

        // More precise low-confidence phrases
        const lowConfidencePhrases = [
            "I don't know",
            "I don't have that information",
            "I don't have information",
            "I'm not sure",
            "I cannot find",
            "I don't have specific information",
            "I'm unable to find",
            "no information available",
            "cannot provide that information"
        ];

        // Check for low confidence indicators in response
        const hasLowConfidencePhrase = lowConfidencePhrases.some(phrase =>
            response.text.toLowerCase().includes(phrase.toLowerCase())
        );

        // More intelligent escalation logic
        const needsEscalation = !response.text ||
            response.text.length < 10 ||
            hasLowConfidencePhrase ||
            (confidence < 0.6 && !hasSpecificInfo); // Only escalate if low confidence AND no specific info

        console.log(`🤖 Escalation needed: ${needsEscalation} (confidence: ${confidence.toFixed(2)}, has specific info: ${hasSpecificInfo})`);



        if (needsEscalation) {
            const userContext = req.session?.userInfo || {};

            const thread_ts = await postEscalationMessage(
                question,
                sessionId
            );
            return res.json({
                answer: "AI couldn't answer. A human assistant will reply shortly.",
                escalation: true,
                thread_ts
            });
        }

        // Extract sources with proper type detection and prioritization
        const sources = response.sourceDocuments?.map(doc => {
            const source = doc.metadata?.source || 'TransFi Documentation';
            const type = doc.metadata?.type || 'documentation';
            const isFAQ = source.includes('faq.pdf');

            // Determine display source and icon
            let displaySource = source;
            if (isFAQ) {
                displaySource = '📋 FAQ Document';
            } else if (type === 'csv') {
                displaySource = `📊 ${source.split('/').pop()}`;
            } else if (type === 'xlsx') {
                displaySource = `📈 ${source.split('/').pop()}`;
            } else if (source.includes('.pdf')) {
                displaySource = `📄 ${source.split('/').pop()}`;
            } else if (source.includes('.md')) {
                displaySource = `📝 ${source.split('/').pop()}`;
            }

            return {
                content: doc.pageContent.substring(0, 200) + '...',
                source: displaySource,
                type: isFAQ ? 'faq' : type
            };
        }) || [];

        // Sort sources to prioritize content types
        sources.sort((a, b) => {
            const typeOrder = { 'faq': 1, 'csv': 2, 'xlsx': 3, 'documentation': 4 };
            return (typeOrder[a.type] || 5) - (typeOrder[b.type] || 5);
        });

        console.log(`✅ Generated answer with ${sources.length} sources`);

        // Build enhanced response with order analysis
        const enhancedResponse = {
            answer: response.text,
            sources: sources,
            timestamp: new Date().toISOString()
        };

        // Add order analysis if relevant
        if (orderAnalysis.isOrderRelated) {
            enhancedResponse.orderAnalysis = {
                isOrderRelated: true,
                confidence: orderAnalysis.confidence,
                type: orderAnalysis.analysis.transactionType,
                urgency: orderAnalysis.analysis.urgency,
                hasOrderIds: orderAnalysis.orderIdExtraction.found,
                orderIds: orderAnalysis.orderIdExtraction.orderIds,
                recommendedAction: orderAnalysis.recommendedAction
            };
        }

        res.json(enhancedResponse);

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

// Endpoint to view learned Q&A pairs
app.get('/api/learning/qa-pairs', async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const qaPairs = await HumanLearningRepository.getTopAnswers(parseInt(limit));

        res.json({
            total: qaPairs.length,
            qaPairs: qaPairs.map(qa => ({
                id: qa._id,
                question: qa.originalQuestion,
                answer: qa.humanAnswer,
                usageCount: qa.usageCount,
                confidence: qa.confidence,
                language: qa.language,
                createdAt: qa.createdAt,
                lastUsed: qa.lastUsed
            }))
        });
    } catch (error) {
        console.error('❌ Error fetching learned Q&A pairs:', error);
        res.status(500).json({
            error: 'Failed to fetch learned Q&A pairs'
        });
    }
});

// Endpoint to get learning statistics
app.get('/api/learning/stats', async (req, res) => {
    try {
        const stats = await HumanLearningRepository.getStats();
        res.json(stats[0] || { totalQAs: 0, totalUsage: 0, avgUsage: 0, languages: [] });
    } catch (error) {
        console.error('❌ Error fetching learning stats:', error);
        res.status(500).json({
            error: 'Failed to fetch learning stats'
        });
    }
});

// Endpoint to manually update the markdown knowledge base file
app.post('/api/learning/update-markdown', async (req, res) => {
    try {
        const filePath = await HumanLearningRepository.updateMarkdownFile();
        res.json({
            message: 'Markdown file updated successfully',
            filePath,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error updating markdown file:', error);
        res.status(500).json({
            error: 'Failed to update markdown file'
        });
    }
});

function detectIntent(question) {
    const intents = {
        authentication: ['auth', 'login', 'api key', 'oauth', 'token'],
        payment: ['payment', 'pay', 'transaction', 'charge', 'refund'],
        webhook: ['webhook', 'callback', 'notification', 'event'],
        integration: ['integrate', 'setup', 'install', 'configure'],
        error: ['error', 'issue', 'problem', 'not working', 'failed']
    };

    const lowerQuestion = question.toLowerCase();
    for (const [intent, keywords] of Object.entries(intents)) {
        if (keywords.some(keyword => lowerQuestion.includes(keyword))) {
            return intent;
        }
    }
    return 'general';
}

function determinePriority(question, userContext = {}) {
    // Determine priority based on keywords or user context
    const urgentKeywords = ['urgent', 'asap', 'critical', 'down', 'broken'];
    const lowerQuestion = question.toLowerCase();

    if (urgentKeywords.some(keyword => lowerQuestion.includes(keyword))) {
        return 'urgent';
    }
    if (userContext?.isPremium) {
        return 'high';
    }
    return 'medium';
}

// Clean up old cache periodically
setInterval(async () => {
    try {
        await KnowledgeCacheRepository.cleanExpired();
        console.log('🧹 Cleaned expired cache entries');
    } catch (error) {
        console.error('Error cleaning cache:', error);
    }
}, 60 * 60 * 1000); // Every hour

// Record daily analytics
setInterval(async () => {
    try {
        await AnalyticsRepository.recordDailyMetrics();
        console.log('📊 Recorded daily analytics');
    } catch (error) {
        console.error('Error recording analytics:', error);
    }
}, 24 * 60 * 60 * 1000); // Every 24 hours

// Start server
app.listen(PORT, async () => {
    console.log(`🌐 Server running on http://localhost:${PORT}`);
    console.log('📚 Initializing documentation system...');

    try {
        await connectDB();
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
