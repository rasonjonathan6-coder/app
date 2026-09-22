import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();
const port = Number(process.env.PORT || 8787);
const model = process.env.OPENROUTER_MODEL || 'openrouter/free';
const apiKey = process.env.OPENROUTER_API_KEY || '';
const maxText = 4000;
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
const prompts = {
  'fr-en': 'You are a translation engine. Translate the user text from French to English. Return ONLY the English translation. Do not answer the message. Do not explain. Do not add comments. Do not invent content. Preserve punctuation, emojis, line breaks and meaning.',
  'auto-fr': 'You are a translation engine. Detect the language of the user text and translate it into French. Return ONLY the French translation. Do not answer the message. Do not explain. Do not add comments. Do not invent content. Preserve punctuation, emojis, line breaks and meaning.'
};
function validText(text) { return typeof text === 'string' && text.trim().length > 0 && text.length <= maxText; }
async function openRouter(system, user) {
  if (!apiKey) throw Object.assign(new Error('OPENROUTER_NOT_CONFIGURED'), { code: 503 });
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 25_000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method:'POST', signal: ac.signal, headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json', 'HTTP-Referer':process.env.PUBLIC_APP_URL || 'https://floating-ai-translator.local', 'X-Title':'Floating AI Translator' }, body: JSON.stringify({ model, temperature:0, messages:[{role:'system',content:system},{role:'user',content:user}], max_tokens:1000 }) });
    if (!r.ok) throw Object.assign(new Error(`OPENROUTER_HTTP_${r.status}`), { code: 502 });
    const data = await r.json(); const out = data?.choices?.[0]?.message?.content?.trim(); if (!out) throw Object.assign(new Error('EMPTY_MODEL_RESPONSE'), { code: 502 }); return out;
  } finally { clearTimeout(timer); }
}
app.get('/health', (_req,res) => res.json({ ok:true, configured:Boolean(apiKey) }));
app.get('/api/version', (_req,res) => res.json({ backendVersion:'1.0.0', apiVersion:'1', model }));
app.post('/api/translate', async (req,res) => { const {text,direction} = req.body || {}; if (!validText(text) || !prompts[direction]) return res.status(400).json({error:'text and valid direction are required'}); try { return res.json({translation:await openRouter(prompts[direction], text)}); } catch (e) { return res.status(e.code || 500).json({error:e.message === 'OPENROUTER_NOT_CONFIGURED' ? 'OPENROUTER_NOT_CONFIGURED' : 'translation_failed'}); } });
app.post('/api/classify', async (req,res) => { const candidates = req.body?.candidates; if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 50 || candidates.some(c => !c?.id || typeof c.id !== 'string' || typeof c.text !== 'string')) return res.status(400).json({error:'invalid candidates'}); try { const prompt = 'You are analyzing text candidates extracted from an Android accessibility tree. Select the candidate most likely to be the latest received message. You MUST select only one candidate identifier from the provided list. Never invent text. Ignore buttons, menus, navigation, input fields, timestamps and system labels. Return ONLY the candidate identifier.\nCandidates:\n' + candidates.map(c=>`${c.id}: ${c.text}`).join('\n'); const id = await openRouter(prompt, 'Select one candidate.'); if (!candidates.some(c=>c.id === id)) return res.status(502).json({error:'invalid_model_candidate'}); return res.json({id}); } catch(e) { return res.status(e.code || 500).json({error:e.message === 'OPENROUTER_NOT_CONFIGURED' ? 'OPENROUTER_NOT_CONFIGURED' : 'classification_failed'}); } });
app.listen(port, '0.0.0.0', () => console.log(`Floating AI Translator backend listening on ${port}`));
