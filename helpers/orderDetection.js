// helpers/orderDetection.js - Order and Transaction Detection Helper

/**
 * Detects if user text is related to orders, transactions, or payments
 * @param {string} text - User input text
 * @returns {object} Detection results with type and confidence
 */
export function detectTransactionRelated(text) {
    if (!text || typeof text !== 'string') {
        return {
            isTransactionRelated: false,
            confidence: 0,
            type: null,
            keywords: []
        };
    }

    const lowerText = text.toLowerCase().trim();

    // Transaction/Order related keywords with weights
    const keywords = {
        // Order-related (high weight)
        order: { weight: 0.9, category: 'order' },
        'order id': { weight: 1.0, category: 'order' },
        'order number': { weight: 1.0, category: 'order' },
        'order status': { weight: 1.0, category: 'order' },
        'my order': { weight: 0.95, category: 'order' },

        // Transaction-related (high weight)
        transaction: { weight: 0.9, category: 'transaction' },
        'transaction id': { weight: 1.0, category: 'transaction' },
        'transaction status': { weight: 1.0, category: 'transaction' },
        'my transaction': { weight: 0.95, category: 'transaction' },
        'txn': { weight: 0.8, category: 'transaction' },
        'tx': { weight: 0.7, category: 'transaction' },

        // Payment-related (medium-high weight)
        payment: { weight: 0.8, category: 'payment' },
        'payment status': { weight: 0.9, category: 'payment' },
        'payment failed': { weight: 0.95, category: 'payment' },
        'payment pending': { weight: 0.95, category: 'payment' },
        'payment successful': { weight: 0.9, category: 'payment' },
        'payment issue': { weight: 0.9, category: 'payment' },
        paid: { weight: 0.6, category: 'payment' },
        unpaid: { weight: 0.7, category: 'payment' },

        // Money/Transfer related (medium weight)
        transfer: { weight: 0.7, category: 'transfer' },
        'money transfer': { weight: 0.8, category: 'transfer' },
        send: { weight: 0.5, category: 'transfer' },
        receive: { weight: 0.5, category: 'transfer' },
        'sent money': { weight: 0.8, category: 'transfer' },
        'received money': { weight: 0.8, category: 'transfer' },

        // Status-related (medium weight)
        status: { weight: 0.6, category: 'status' },
        pending: { weight: 0.7, category: 'status' },
        failed: { weight: 0.8, category: 'status' },
        completed: { weight: 0.7, category: 'status' },
        processing: { weight: 0.8, category: 'status' },
        cancelled: { weight: 0.8, category: 'status' },
        refund: { weight: 0.8, category: 'status' },
        refunded: { weight: 0.8, category: 'status' },

        // Problem indicators (high weight)
        'not received': { weight: 0.9, category: 'issue' },
        'didn\'t receive': { weight: 0.9, category: 'issue' },
        'haven\'t received': { weight: 0.9, category: 'issue' },
        'missing': { weight: 0.8, category: 'issue' },
        'lost': { weight: 0.7, category: 'issue' },
        'stuck': { weight: 0.8, category: 'issue' },
        'delayed': { weight: 0.8, category: 'issue' },

        // Question indicators (medium weight)
        'where is': { weight: 0.6, category: 'inquiry' },
        'when will': { weight: 0.6, category: 'inquiry' },
        'why is': { weight: 0.6, category: 'inquiry' },
        'how long': { weight: 0.6, category: 'inquiry' },
        'what happened': { weight: 0.7, category: 'inquiry' },
        'what\'s wrong': { weight: 0.8, category: 'inquiry' }
    };

    let totalScore = 0;
    let matchedKeywords = [];
    let primaryCategory = null;
    let categoryScores = {};

    // Check for keyword matches
    Object.entries(keywords).forEach(([keyword, data]) => {
        if (lowerText.includes(keyword)) {
            totalScore += data.weight;
            matchedKeywords.push(keyword);

            // Track category scores
            if (!categoryScores[data.category]) {
                categoryScores[data.category] = 0;
            }
            categoryScores[data.category] += data.weight;
        }
    });

    // Determine primary category
    if (Object.keys(categoryScores).length > 0) {
        primaryCategory = Object.entries(categoryScores)
            .sort(([, a], [, b]) => b - a)[0][0];
    }

    // Normalize confidence (cap at 1.0)
    const confidence = Math.min(totalScore, 1.0);

    // Determine if transaction-related (threshold: 0.5)
    const isTransactionRelated = confidence >= 0.5;

    return {
        isTransactionRelated,
        confidence: parseFloat(confidence.toFixed(2)),
        type: isTransactionRelated ? primaryCategory : null,
        keywords: matchedKeywords,
        categoryScores,
        analysis: {
            totalScore: parseFloat(totalScore.toFixed(2)),
            threshold: 0.5,
            primaryCategory
        }
    };
}

/**
 * Extracts order IDs from text using regex patterns
 * @param {string} text - Input text to search for order IDs
 * @returns {object} Extraction results with found order IDs
 */
export function extractOrderIds(text) {
    if (!text || typeof text !== 'string') {
        return {
            found: false,
            orderIds: [],
            patterns: []
        };
    }

    const orderIds = [];
    const patterns = [];

    // Define order ID patterns
    const orderIdPatterns = [
        {
            name: 'OR-Pattern',
            regex: /\bOR-\d{12,20}\b/gi,
            description: 'OR-XXXXXXXXXXXX format (12-20 digits)'
        },
        {
            name: 'TXN-Pattern',
            regex: /\bTXN-\d{10,20}\b/gi,
            description: 'TXN-XXXXXXXXXX format (10-20 digits)'
        },
        {
            name: 'TransFi-Pattern',
            regex: /\bTF-\d{10,20}\b/gi,
            description: 'TF-XXXXXXXXXX format (10-20 digits)'
        },
        {
            name: 'Generic-Order',
            regex: /\b(?:order|transaction)[\s-]?(?:id[\s:]?)?([A-Z0-9]{8,25})\b/gi,
            description: 'Generic order/transaction ID patterns'
        },
        {
            name: 'UUID-Pattern',
            regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
            description: 'UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)'
        },
        {
            name: 'Alphanumeric-ID',
            regex: /\b[A-Z]{2,4}[0-9]{8,20}\b/g,
            description: 'Alphanumeric IDs (2-4 letters + 8-20 digits)'
        }
    ];

    // Extract order IDs using each pattern
    orderIdPatterns.forEach(pattern => {
        const matches = text.match(pattern.regex);
        if (matches) {
            const uniqueMatches = [...new Set(matches)]; // Remove duplicates
            uniqueMatches.forEach(match => {
                orderIds.push({
                    id: match.trim(),
                    pattern: pattern.name,
                    description: pattern.description
                });
            });
            patterns.push({
                name: pattern.name,
                matches: uniqueMatches.length,
                description: pattern.description
            });
        }
    });

    // Remove duplicates based on ID value and extract just the ID strings
    const uniqueOrderIds = orderIds
        .filter((item, index, array) =>
            array.findIndex(other => other.id.toLowerCase() === item.id.toLowerCase()) === index
        )
        .map(item => item.id); // Extract just the ID string

    return {
        found: uniqueOrderIds.length > 0,
        orderIds: uniqueOrderIds, // Now just an array of strings
        patterns: patterns,
        summary: {
            totalFound: uniqueOrderIds.length,
            mostLikelyOrderId: uniqueOrderIds.length > 0 ? uniqueOrderIds[0] : null
        }
    };
}

/**
 * Combined function to analyze user text for transaction/order context
 * @param {string} text - User input text
 * @returns {object} Complete analysis including detection and extraction
 */
export function analyzeOrderQuery(text) {
    const transactionDetection = detectTransactionRelated(text);
    const orderIdExtraction = extractOrderIds(text);

    // Enhanced confidence if order IDs are found
    let enhancedConfidence = transactionDetection.confidence;
    if (orderIdExtraction.found) {
        enhancedConfidence = Math.min(enhancedConfidence + 0.3, 1.0);
    }

    return {
        isOrderRelated: transactionDetection.isTransactionRelated || orderIdExtraction.found,
        confidence: parseFloat(enhancedConfidence.toFixed(2)),
        transactionDetection,
        orderIdExtraction,
        recommendedAction: determineRecommendedAction(transactionDetection, orderIdExtraction),
        analysis: {
            hasOrderIds: orderIdExtraction.found,
            transactionType: transactionDetection.type,
            urgency: calculateUrgency(transactionDetection, text)
        }
    };
}

/**
 * Determines recommended action based on analysis
 * @param {object} transactionDetection - Transaction detection results
 * @param {object} orderIdExtraction - Order ID extraction results
 * @returns {string} Recommended action
 */
function determineRecommendedAction(transactionDetection, orderIdExtraction) {
    if (orderIdExtraction.found) {
        if (transactionDetection.type === 'issue') {
            return 'escalate_with_order_id';
        }
        return 'lookup_order_status';
    }

    if (transactionDetection.isTransactionRelated) {
        if (transactionDetection.type === 'issue') {
            return 'request_order_id';
        }
        return 'provide_general_transaction_help';
    }

    return 'general_support';
}

/**
 * Calculates urgency level based on keywords and context
 * @param {object} transactionDetection - Transaction detection results
 * @param {string} text - Original text
 * @returns {string} Urgency level
 */
function calculateUrgency(transactionDetection, text) {
    const urgentKeywords = ['urgent', 'emergency', 'asap', 'immediately', 'stuck', 'lost', 'missing', 'failed'];
    const lowerText = text.toLowerCase();

    const hasUrgentKeywords = urgentKeywords.some(keyword => lowerText.includes(keyword));
    const isIssueType = transactionDetection.type === 'issue';
    const highConfidence = transactionDetection.confidence > 0.8;

    if (hasUrgentKeywords && isIssueType) return 'high';
    if (isIssueType && highConfidence) return 'medium';
    if (transactionDetection.isTransactionRelated) return 'low';

    return 'normal';
}

// Export all functions
export default {
    detectTransactionRelated,
    extractOrderIds,
    analyzeOrderQuery
};