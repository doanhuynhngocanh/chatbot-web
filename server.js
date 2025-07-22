require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const stringSimilarity = require('string-similarity');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// Serve static files from the root and public directory
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

const conversationHistory = {}; // { sessionId: [ {role, content}, ... ] }
const contactInfoState = {}; // { sessionId: { step, data, orgMode } }
const CONTACT_INFO_FILE = path.join(__dirname, 'contact_info.json');

function saveContactInfo(info) {
    let allInfo = [];
    try {
        if (fs.existsSync(CONTACT_INFO_FILE)) {
            allInfo = JSON.parse(fs.readFileSync(CONTACT_INFO_FILE, 'utf-8'));
        }
    } catch (e) { allInfo = []; }
    allInfo.push(info);
    fs.writeFileSync(CONTACT_INFO_FILE, JSON.stringify(allInfo, null, 2));
}

const SYSTEM_PROMPT = `You are a helpful assistant that only answers questions based on information from https://www.housingcantwait.org and https://fahe.org/about/. When possible, focus your answers on the content from https://www.housingcantwait.org/impact/. Fahe always stands for 'Federation of Appalachian Housing Enterprises.' Never say it stands for anything else. If a question is not related to these websites, respond with: 'I'm here to help with questions about the Housing Can't Wait campaign and Fahe. Please visit https://www.housingcantwait.org or https://fahe.org/about/ for more.'`;

// Load keywords from client_routes.json
const clientRoutes = JSON.parse(fs.readFileSync(path.join(__dirname, 'client_routes.json'), 'utf-8'));
const allKeywords = Object.values(clientRoutes).flatMap(obj => obj.keywords.map(k => k.toLowerCase()));

// Add core concepts for more flexible matching
const coreConcepts = [
  'housing', 'can’t wait', 'cant wait', 'campaign', 'fahe', 'disaster', 'recovery', 'support', 'help', 'organization', 'partner', 'invest', 'policy', 'advocate', 'government', 'local', 'corporate', 'brand', 'sponsor', 'resident', 'flood', 'appalachia', 'home', 'homes', 'community', 'communities', 'intake', 'form', 'program', 'grant', 'cdbg-dr', 'kentucky', 'impact', 'join', 'donate', 'volunteer', 'stories', 'expert', 'challenge', 'crisis', 'rebuild', 'rehabilitate', 'build', 'service', 'services', 'fund', 'funding', 'investment', 'investor', 'collaborate', 'collaboration', 'planning', 'planning', 'initiative', 'initiatives', 'brand partnership', 'brand partnerships', 'brand partner', 'brand partners'
];

const FALLBACK_MESSAGE = "I'm here to answer questions about the Housing Can't Wait campaign and Fahe. Please visit https://www.housingcantwait.org or https://fahe.org/about/ for more details.";

// Load FAQs from faqs.json
const faqsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'faqs.json'), 'utf-8'));

// Welcome options for fuzzy matching
const welcomeOptions = [
    "What is the Housing Can't Wait campaign?",
    "How can I get help with housing?",
    "How can I partner or invest?",
    "How can my organization get involved?"
];

app.get('/api/faqs', (req, res) => {
    res.json(faqsData);
});

// Helper: check if question is vague
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

// Helper: normalize strings for better fuzzy matching
function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Helper: fuzzy match to FAQ or welcome options
function isFuzzyMatch(userMsg) {
    const allFaqQuestions = [];
    Object.values(faqsData).forEach(group => {
        group.faqs.forEach(faq => allFaqQuestions.push(faq.question));
    });
    const candidates = allFaqQuestions.concat(welcomeOptions);
    const userNorm = normalize(userMsg);
    const candidateNorms = candidates.map(normalize);
    const matches = stringSimilarity.findBestMatch(userNorm, candidateNorms);
    return matches.bestMatch.rating > 0.3; // lowered threshold for similarity
}

// Helper: check if at least two relevant keywords are present
function hasMultipleRelevantKeywords(userMsg) {
    const userNorm = normalize(userMsg);
    let count = 0;
    allKeywords.concat(coreConcepts).forEach(keyword => {
        if (userNorm.includes(keyword)) count++;
    });
    return count >= 2;
}

app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) {
        return res.status(400).json({ error: 'Missing message or sessionId' });
    }

    // Normalize message once for reuse
    const normMsg = normalize(message);

    // Start contact info flow if user requests it
    if (normMsg === normalize('I would like to leave my contact information.')) {
        contactInfoState[sessionId] = { step: 'ask_name', data: {}, orgMode: message.toLowerCase().includes('my organization') };
        return res.json({ reply: 'Great! Please provide your name:' });
    }

    // Contact info collection state machine
    if (contactInfoState[sessionId] && contactInfoState[sessionId].step) {
        const state = contactInfoState[sessionId];
        if (state.step === 'ask_name') {
            state.data.name = message;
            state.step = 'ask_phone';
            return res.json({ reply: 'Please provide your phone number:' });
        }
        if (state.step === 'ask_phone') {
            state.data.phone = message;
            state.step = 'ask_email';
            return res.json({ reply: 'Please provide your email address:' });
        }
        if (state.step === 'ask_email') {
            state.data.email = message;
            if (state.orgMode) {
                state.step = 'ask_org';
                return res.json({ reply: 'What is your organization?' });
            } else {
                state.step = 'ask_address';
                return res.json({ reply: 'Please provide your address. If you are working for an organization, please provide your organization\'s name:' });
            }
        }
        if (state.step === 'ask_org') {
            state.data.organization = message;
            saveContactInfo(state.data);
            delete contactInfoState[sessionId];
            return res.json({ reply: 'Thank you! Your contact information has been saved.' });
        }
        if (state.step === 'ask_address') {
            state.data.address = message;
            saveContactInfo(state.data);
            delete contactInfoState[sessionId];
            return res.json({ reply: 'Thank you! Your contact information has been saved.' });
        }
    }

    // Direct FAQ answer for 'What is Fahe?' or 'Who is Fahe?'
    const faheQuestions = [
        normalize('What is Fahe?'),
        normalize('Who is Fahe?')
    ];
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

    // Initialize history if new session
    if (!conversationHistory[sessionId]) {
        conversationHistory[sessionId] = [
            { role: 'system', content: SYSTEM_PROMPT }
        ];
    }

    // If vague, clarify for the AI
    if (vague) {
      conversationHistory[sessionId].push({
        role: 'user',
        content: message + " (The user is asking about the Housing Can't Wait campaign.)"
      });
    } else {
      conversationHistory[sessionId].push({ role: 'user', content: message });
    }

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: conversationHistory[sessionId],
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const botMessage = response.data.choices[0].message.content;
        // Add bot message to history
        conversationHistory[sessionId].push({ role: 'assistant', content: botMessage });

        res.json({ reply: botMessage });
    } catch (err) {
        res.status(500).json({ error: 'OpenAI API error', details: err.message });
    }
});

// Serve index.html for any GET request that doesn't match /api/*
app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}); 