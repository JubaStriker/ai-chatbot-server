// helpers/orderDetection.js - Order and Transaction Detection Helper

/**
 * Detects if user text is related to orders, transactions, or payments
 * Now only detects based on actual order ID presence - no keyword detection
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

    // This function now only returns false - actual detection is done via order ID extraction
    // This prevents false positives from general questions about payments/transactions
    return {
        isTransactionRelated: false,
        confidence: 0,
        type: null,
        keywords: [],
        categoryScores: {},
        analysis: {
            totalScore: 0,
            threshold: 0.5,
            primaryCategory: null
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