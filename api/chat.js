const axios = require('axios');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const faqsData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'faqs.json'), 'utf-8'));
const clientRoutes = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'client_routes.json'), 'utf-8'));
const allKeywords = Object.values(clientRoutes).flatMap(obj => obj.keywords.map(k => k.toLowerCase()));
const coreConcepts = [
  'housing', 'can’t wait', 'cant wait', 'campaign', 'fahe', 'disaster', 'recovery', 'support', 'help', 'organization', 'partner', 'invest', 'policy', 'advocate', 'government', 'local', 'corporate', 'brand', 'sponsor', 'resident', 'flood', 'appalachia', 'home', 'homes', 'community', 'communities', 'intake', 'form', 'program', 'grant', 'cdbg-dr', 'kentucky', 'impact', 'join', 'donate', 'volunteer', 'stories', 'expert', 'challenge', 'crisis', 'rebuild', 'rehabilitate', 'build', 'service', 'services', 'fund', 'funding', 'investment', 'investor', 'collaborate', 'collaboration', 'planning', 'planning', 'initiative', 'initiatives', 'brand partnership', 'brand partnerships', 'brand partner', 'brand partners'
];

const SYSTEM_PROMPT = `You are a helpful assistant that only answers questions based on information from https://www.housingcantwait.org and https://fahe.org/about/. When possible, focus your answers on the content from https://www.housingcantwait.org/impact/. Fahe always stands for 'Federation of Appalachian Housing Enterprises.' Never say it stands for anything else. If a question is not related to these websites, respond with: 'I'm here to help with questions about the Housing Can't Wait campaign and Fahe. Please visit https://www.housingcantwait.org or https://fahe.org/about/ for more.'`;
const FALLBACK_MESSAGE = "I'm here to answer questions about the Housing Can't Wait campaign and Fahe. Please visit https://www.housingcantwait.org or https://fahe.org/about/ for more details.";

function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function isVagueQuestion(msg) {
  const vaguePatterns = [
    /what is this\??$/i,
    /what is this campaign\??$/i,
    /tell me more/i,
    /can you explain/i,
    /what do you do/i,
    /who are you/i,
    /what is it\??$/i
  ];
  return vaguePatterns.some(re => re.test(msg));
}
function isFuzzyMatch(userMsg) {
    const allFaqQuestions = [];
    Object.values(faqsData).forEach(group => {
        group.faqs.forEach(faq => allFaqQuestions.push(faq.question));
    });
    const welcomeOptions = [
        "What is the Housing Can't Wait campaign?",
        "How can I get help with housing?",
        "How can I partner or invest?",
        "How can my organization get involved?",
        "Who is Fahe?",
        "I would like to leave my contact information."
    ];
    const candidates = allFaqQuestions.concat(welcomeOptions);
    const userNorm = normalize(userMsg);
    const candidateNorms = candidates.map(normalize);
    const matches = stringSimilarity.findBestMatch(userNorm, candidateNorms);
    return matches.bestMatch.rating > 0.3;
}
function hasMultipleRelevantKeywords(userMsg) {
    const userNorm = normalize(userMsg);
    let count = 0;
    allKeywords.concat(coreConcepts).forEach(keyword => {
        if (userNorm.includes(keyword)) count++;
    });
    return count >= 2;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const { message, sessionId } = req.body;
    if (!message || !sessionId) {
        return res.status(400).json({ error: 'Missing message or sessionId' });
    }
    const normMsg = normalize(message);
    // Direct FAQ answer for 'What is Fahe?' or 'Who is Fahe?'
    const faheQuestions = [normalize('What is Fahe?'), normalize('Who is Fahe?')];
    if (faheQuestions.some(q => normMsg === q)) {
        const faheFaq = faqsData.fahe.faqs.find(faq => faheQuestions.includes(normalize(faq.question)));
        if (faheFaq) {
            return res.json({ reply: faheFaq.answer });
        }
    }
    // Direct FAQ answer for help/disaster recovery (fuzzy match)
    const helpFaqs = faqsData.residents.faqs;
    const helpQuestionsNorm = helpFaqs.map(faq => normalize(faq.question));
    const helpMatch = stringSimilarity.findBestMatch(normMsg, helpQuestionsNorm);
    if (helpMatch.bestMatch.rating > 0.4) {
        const matchedFaq = helpFaqs[helpMatch.bestMatchIndex];
        return res.json({ reply: matchedFaq.answer });
    }
    // Flexible keyword/concept check (case-insensitive, partial match)
    const messageLower = message.toLowerCase();
    const isRelated = allKeywords.concat(coreConcepts).some(keyword => messageLower.includes(keyword));
    const vague = isVagueQuestion(message);
    const fuzzy = isFuzzyMatch(message);
    const multiKeywords = hasMultipleRelevantKeywords(message);
    if (!isRelated && !vague && !fuzzy && !multiKeywords) {
        return res.json({ reply: FALLBACK_MESSAGE });
    }
    // Conversation history is not persisted in serverless, so just use system prompt and user message
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: vague ? message + " (The user is asking about the Housing Can't Wait campaign.)" : message }
    ];
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: messages,
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log(response.data); // Debug: log the full OpenAI response
        const botMessage = response.data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
        return res.json({ reply: botMessage });
    } catch (err) {
        console.error('OpenAI API error:', err.response?.data || err.message || err);
        return res.status(500).json({ error: 'OpenAI API error', details: err.response?.data || err.message || err });
    }
} 