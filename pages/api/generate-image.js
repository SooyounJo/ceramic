import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { saveArchive } from "@/lib/archive";

const MODEL_ID = "gemini-3.1-flash-image-preview";
const OPENAI_TRANSLATE_MODEL = "gpt-4.1-mini";
const OPENAI_CMF_MODEL = "gpt-4.1-mini";

function pickInlineData(part) {
  return part?.inlineData || part?.inline_data || null;
}

function normalizeUpstreamError(e) {
  if (!e) return "요청 처리 중 오류가 발생했습니다.";
  if (typeof e === "string") return e;
  if (e?.message) {
    const msg = String(e.message);
    // @google/genai가 에러 내용을 JSON 문자열로 담아주는 케이스가 있음
    // 예: {"error":{"code":400,"message":"API key not valid..."}}
    try {
      const parsed = JSON.parse(msg);
      const inner =
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.error ||
        (typeof parsed === "string" ? parsed : null);
      if (inner) return String(inner);
    } catch {
      // ignore
    }
    return msg;
  }
  return "요청 처리 중 오류가 발생했습니다.";
}

function clampString(v, maxLen) {
  const s = (v ?? "").toString();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function readPromptFile(relPath) {
  const fullPath = path.join(process.cwd(), relPath);
  return fs.readFileSync(fullPath, "utf8");
}

function extractOpenAIText(resp) {
  if (!resp) return "";
  if (typeof resp.output_text === "string" && resp.output_text.trim()) return resp.output_text.trim();
  // Fallback: try to walk structured output
  const out = resp.output || [];
  for (const item of out) {
    const content = item?.content || [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) {
        return c.text.trim();
      }
    }
  }
  return "";
}

async function openaiText({ apiKey, system, user, model }) {
  const client = new OpenAI({ apiKey });
  const resp = await client.responses.create({
    model,
    temperature: 0.2,
    max_output_tokens: 450,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: user }] },
    ],
  });

  const text = extractOpenAIText(resp);
  if (!text) throw new Error("OpenAI 응답 텍스트를 추출하지 못했습니다.");
  return text;
}

function singleLine(s) {
  const t = (s || "").toString();
  const firstLine = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0];
  return (firstLine || "").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      prompt,
      emotion,
      checkIn,
      optionalNotes,
      aspectRatio,
      imageSize,
      includeText = true,
      useSearchGrounding = false,
      apiKey,
      openaiApiKey,
      inputs,
    } = req.body || {};

    const apiKeyFinal = (process.env.GEMINI_API_KEY || apiKey || "").trim();
    if (!apiKeyFinal) {
      return res.status(400).json({
        error:
          "GEMINI_API_KEY가 없습니다. `.env.local`에 GEMINI_API_KEY를 설정하거나, 화면에서 API 키를 입력해 주세요.",
      });
    }

    const checkInTranscriptKo = clampString(
      checkIn?.transcriptKo ??
        (Array.isArray(checkIn?.answers)
          ? checkIn.answers.filter(Boolean).join("\n")
          : "") ??
        inputs?.checkIn?.answers?.filter?.(Boolean)?.join?.("\n") ??
        "",
      6000,
    ).trim();

    const emotionRaw = clampString(
      emotion ?? inputs?.emotion ?? checkInTranscriptKo ?? "",
      3000,
    ).trim();
    const notesRaw = clampString(optionalNotes ?? inputs?.optionalNotes ?? "", 800).trim();
    let promptKo = clampString(prompt, 12000).trim();
    if (!promptKo) {
      if (!emotionRaw) return res.status(400).json({ error: "감정(Emotion/Mood)이 비어있습니다." });
      promptKo = [
        "목표: 감정(무드)에 따라 자연스러운 형상과 질감을 가진 도자기 오브젝트 1개(병/단지/화병 형태) 생성.",
        `감정/무드(Emotion/Mood): ${emotionRaw}`,
        notesRaw ? `추가 요청: ${notesRaw}` : "",
        "방향: 매우 추상적인 조형 작품. 재질은 하이브리드/모호해도 됨. 텍스타일/석재/유리질/레진/왁스/종이/폼 같은 표면 착시 가능.",
        "형태 제약: 구(스피어) 금지. 정확히 오브젝트 1개만 (유기적 실루엣).",
        "환경: 순백(#FFFFFF) 배경, 미니멀 스튜디오, 다른 오브젝트 없음.",
        "금지: 텍스트/로고/라벨/워터마크/설명 문구.",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const openaiKeyFinal = (process.env.OPENAI_API_KEY || openaiApiKey || "").trim();
    if (!openaiKeyFinal) {
      return res.status(400).json({
        error:
          "OPENAI_API_KEY가 없습니다. `.env.local`에 OPENAI_API_KEY를 설정하거나, 화면에서 OpenAI API 키를 입력해 주세요.",
      });
    }

    let visualWordsKo = "";
    let visualWordsEn = "";
    let promptEn = "";
    let promptCmf = "";
    try {
      const translateSystem = readPromptFile("prompts/translate_ko_to_en.txt");
      const visualSystem = readPromptFile("prompts/emotion_to_visual_words_ko.txt");
      const cmfBase = readPromptFile("prompts/cmf_builder_en.txt");
      const masterTemplate = readPromptFile("prompts/cmf_master_template_en.txt");
      const cmfSystem = cmfBase.replace("{{MASTER_TEMPLATE}}", masterTemplate);

      if (emotionRaw) {
        visualWordsKo = await openaiText({
          apiKey: openaiKeyFinal,
          system: visualSystem,
          user: `${emotionRaw}${notesRaw ? `\n\nnotes: ${notesRaw}` : ""}`,
          model: OPENAI_TRANSLATE_MODEL,
        });
      }

      const mEmotion = String(visualWordsKo || "").match(/^EMOTION:\s*(.+)$/m);
      const emotionFromVisualWords = (mEmotion?.[1] || "").trim();
      const emotionUsed = emotionFromVisualWords || clampString(emotionRaw, 240).trim();

      if (visualWordsKo) {
        visualWordsEn = await openaiText({
          apiKey: openaiKeyFinal,
          system: translateSystem,
          user: visualWordsKo,
          model: OPENAI_TRANSLATE_MODEL,
        });
      }

      // Build an English structured input for the CMF builder.
      // This avoids losing nuance and forces high-density realism.
      promptEn = [
        "GOAL: Generate one realistic handmade ceramic object image for product visualization.",
        `EMOTION: ${emotionUsed || ""}`.trim(),
        visualWordsEn ? `VISUAL_WORDS_EN: ${singleLine(visualWordsEn)}` : "",
        notesRaw ? `NOTES: ${notesRaw}` : "",
        "CONSTRAINTS: One object only (organic vase/jar/bottle-like). Pure white background (#FFFFFF). No props. No text/logos/watermarks. Not a sphere.",
      ]
        .filter(Boolean)
        .join("\n");

      promptCmf = await openaiText({
        apiKey: openaiKeyFinal,
        system: cmfSystem,
        user: promptEn,
        model: OPENAI_CMF_MODEL,
      });
      promptCmf = singleLine(promptCmf);
    } catch (e) {
      return res.status(502).json({
        error: { message: normalizeUpstreamError(e) },
      });
    }

    const ai = new GoogleGenAI({ apiKey: apiKeyFinal });

    const config = {
      responseModalities: includeText ? ["TEXT", "IMAGE"] : ["IMAGE"],
      imageConfig: {
        aspectRatio: (aspectRatio || "1:1").toString(),
        imageSize: (imageSize || "1K").toString(),
      },
    };

    const request = {
      model: MODEL_ID,
      contents: promptCmf || promptEn || promptKo,
      config: useSearchGrounding
        ? {
            ...config,
            tools: [{ googleSearch: {} }],
          }
        : config,
    };

    let response;
    try {
      response = await ai.models.generateContent(request);
    } catch (e) {
      return res.status(502).json({
        error: { message: normalizeUpstreamError(e) },
      });
    }

    const parts = response?.candidates?.[0]?.content?.parts || [];
    if (!parts.length) {
      return res.status(502).json({
        error: { message: "Gemini 응답이 비어있습니다. 프롬프트/옵션을 바꿔 다시 시도해 주세요." },
      });
    }

    let text = "";
    let imageBase64 = "";
    let mimeType = "image/png";

    for (const part of parts) {
      if (!text && part?.text) text = String(part.text);
      const inline = pickInlineData(part);
      if (!imageBase64 && inline?.data) {
        imageBase64 = String(inline.data);
        if (inline?.mimeType) mimeType = String(inline.mimeType);
        if (inline?.mime_type) mimeType = String(inline.mime_type);
      }
    }

    const image = imageBase64 ? `data:${mimeType};base64,${imageBase64}` : "";

    let archive = null;
    if (imageBase64) {
      try {
        const inputsSafe =
          inputs && typeof inputs === "object"
            ? {
                emotion: clampString(inputs.emotion, 120).trim(),
                optionalNotes: clampString(inputs.optionalNotes, 300).trim(),
              }
            : null;

        archive = await saveArchive({
          imageBase64,
          mimeType,
          promptKo,
          promptEn,
          promptCmf,
          generation: {
            model: MODEL_ID,
            aspectRatio: (aspectRatio || "1:1").toString(),
            imageSize: (imageSize || "1K").toString(),
          },
          inputs: inputsSafe,
        });
      } catch {
        archive = null;
      }
    }

    return res.status(200).json({
      image,
      text,
      promptKo,
      visualWordsKo,
      visualWordsEn,
      promptEn,
      promptCmf,
      archive,
    });
  } catch (e) {
    return res.status(500).json({ error: { message: e?.message || "서버 오류" } });
  }
}

