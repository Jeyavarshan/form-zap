import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  try {
    // The official SDK doesn't expose listModels directly easily in some versions, but let's try fetch
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    console.log(JSON.stringify(data.models.map(m => m.name), null, 2));
  } catch (err) {
    console.error(err);
  }
}
run();
