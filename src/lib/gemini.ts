import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateHydrationNote(amount: number, goal: number, level: number) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are 'H-Bot', a witty hydration assistant. 
      The user just reached a milestone: they drank ${amount}ml out of their ${goal}ml goal.
      They are Level ${level}.
      Generate a short, punchy (max 2 sentences) social media post that sounds fun, slightly cheeky, and professional. 
      Include 2 relevant emojis. 
      Example: "Just hit 2L! My cells are hosting a pool party. 🌊🤖 Level 5 Hydration Master unlocked!"`,
    });
    return response.text || "I'm so hydrated, I'm practically a high-functioning wave! 🌊🤖";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Hydration goal achieved! Feeling fresh and fluid! 💧✨";
  }
}
