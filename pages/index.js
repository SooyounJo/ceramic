import Head from "next/head";
import Link from "next/link";
import styles from "@/styles/Home.module.css";
import { useEffect, useMemo, useRef, useState } from "react";

const MODEL_ID = "gemini-3.1-flash-image-preview";

const ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
  "21:9",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
  "3:4",
  "4:3",
];

const RESOLUTIONS = [
  { label: "512 (0.5K)", value: "512" },
  { label: "1K", value: "1K" },
  { label: "2K", value: "2K" },
  { label: "4K", value: "4K" },
];

// Material / color / finish inputs removed (ceramic is fixed; color & finish inferred from emotion)

const CHECKIN_QUESTIONS = [
  "오늘 하루의 에너지는 어땠어? (0~10 + 한 문장으로)",
  "오늘 가장 오래 남은 감정은 뭐야? 몸에서 느껴지는 위치/압력/리듬을 말해줘.",
  "오늘 가장 강했던 순간은 어떤 방향이었어? (밀어붙임/당김/멈춤/흐름/흩어짐 중 무엇에 가까워?)",
  "오늘 스스로에게 가장 필요했던 건 뭐였어? (보호/정리/확장/휴식/용기/정직 중 무엇이었어?)",
  "지금 이 하루를 한 가지 ‘제스처’로 표현하면 뭐야? (쥐기/풀기/감싸기/비틀기/겹치기/숨기기/드러내기 등)",
];

function buildTranscriptKo(messages) {
  const lines = [];
  for (const m of messages || []) {
    const role = m?.role === "user" ? "USER" : "AI";
    const text = String(m?.text || "").trim();
    if (!text) continue;
    lines.push(`${role}: ${text}`);
  }
  return lines.join("\n");
}

export default function Home() {
  const topRef = useRef(null);
  const resultsRef = useRef(null);

  const [messages, setMessages] = useState(() => [
    { role: "ai", text: CHECKIN_QUESTIONS[0] },
  ]);
  const [draft, setDraft] = useState("");
  const [questionIdx, setQuestionIdx] = useState(0);
  const [optionalNotes, setOptionalNotes] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const [includeText, setIncludeText] = useState(true);
  const [useSearchGrounding, setUseSearchGrounding] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultText, setResultText] = useState("");
  const [resultImageUrl, setResultImageUrl] = useState("");
  const [translatedEn, setTranslatedEn] = useState("");
  const [cmfPromptEn, setCmfPromptEn] = useState("");
  const [archiveInfo, setArchiveInfo] = useState(null);

  const [meshyTaskId, setMeshyTaskId] = useState("");
  const [meshyStatus, setMeshyStatus] = useState(null);
  const [meshyLoading, setMeshyLoading] = useState(false);
  const [meshyError, setMeshyError] = useState("");
  const [meshyAutoDownloaded, setMeshyAutoDownloaded] = useState(false);
  const [driveConnectError, setDriveConnectError] = useState("");

  function scrollToResults() {
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToTop() {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function triggerDownload(url) {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function connectDrive() {
    setDriveConnectError("");
    try {
      const res = await fetch("/api/drive/oauth-url");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
      if (!data?.url) throw new Error("Missing auth url");
      window.location.href = data.url;
    } catch (e) {
      setDriveConnectError(e?.message || "Failed to start OAuth");
    }
  }

  const transcriptKo = useMemo(() => buildTranscriptKo(messages), [messages]);
  const hasUserInput = useMemo(
    () => messages.some((m) => m?.role === "user" && String(m?.text || "").trim()),
    [messages],
  );

  const promptKo = useMemo(() => {
    const parts = [
      "목표: 감정(무드)에 따라 자연스러운 형상과 질감을 가진 도자기 오브젝트 1개(병/단지/화병 형태) 생성.",
      transcriptKo ? `감정 대화 로그:\n${transcriptKo}` : "",
      optionalNotes.trim() ? `추가 요청: ${optionalNotes.trim()}` : "",
      "방향: 매우 추상적인 조형 작품. 재질은 하이브리드/모호해도 됨. 텍스타일/석재/유리질/레진/왁스/종이/폼 같은 표면 착시 가능.",
      "형태 제약: 구(스피어) 금지. 정확히 오브젝트 1개만 (유기적 실루엣).",
      "환경: 순백(#FFFFFF) 배경, 미니멀 스튜디오, 다른 오브젝트 없음.",
      "금지: 텍스트/로고/라벨/워터마크/설명 문구.",
    ].filter(Boolean);
    return parts.join("\n");
  }, [transcriptKo, optionalNotes]);

  const canSubmit = useMemo(
    () => hasUserInput && !loading,
    [hasUserInput, loading],
  );

  function onSendMessage() {
    const txt = draft.trim();
    if (!txt) return;
    setMessages((prev) => {
      const next = [...prev, { role: "user", text: txt }];
      const nextIdx = Math.min(questionIdx + 1, CHECKIN_QUESTIONS.length);
      if (nextIdx < CHECKIN_QUESTIONS.length) {
        next.push({ role: "ai", text: CHECKIN_QUESTIONS[nextIdx] });
      } else if (!prev.some((m) => m?.role === "ai" && String(m?.text || "").includes("체크인이 완료"))) {
        next.push({
          role: "ai",
          text: "체크인이 완료됐어요. 이 대화로 형태/유약/팔레트/마감/표면 디테일을 자동 구성합니다.",
        });
      }
      return next;
    });
    setDraft("");
    setQuestionIdx((i) => Math.min(CHECKIN_QUESTIONS.length, i + 1));
  }

  function resetChat() {
    setMessages([{ role: "ai", text: CHECKIN_QUESTIONS[0] }]);
    setDraft("");
    setQuestionIdx(0);
  }

  async function onGenerate(e) {
    e.preventDefault();

    setLoading(true);
    setError("");
    setResultText("");
    setResultImageUrl("");
    setTranslatedEn("");
    setCmfPromptEn("");
    setArchiveInfo(null);
    setMeshyTaskId("");
    setMeshyStatus(null);
    setMeshyError("");
    setMeshyAutoDownloaded(false);

    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptKo,
          checkIn: {
            questions: CHECKIN_QUESTIONS,
            messages,
            transcriptKo,
          },
          optionalNotes,
          aspectRatio,
          imageSize,
          includeText,
          useSearchGrounding,
          inputs: {
            emotion: transcriptKo,
            checkIn: {
              questions: CHECKIN_QUESTIONS,
              messages,
            },
            optionalNotes,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data?.error?.message ||
          data?.error ||
          data?.message ||
          `요청 실패 (HTTP ${res.status})`;
        throw new Error(message);
      }

      setResultText(data?.text || "");
      setResultImageUrl(data?.image || "");
      setTranslatedEn(data?.promptEn || "");
      setCmfPromptEn(data?.promptCmf || "");
      setArchiveInfo(data?.archive || null);
      if (!data?.image) {
        throw new Error("이미지 응답을 받지 못했습니다. 프롬프트/옵션을 바꿔 다시 시도해 주세요.");
      }
      setTimeout(scrollToResults, 50);
    } catch (err) {
      setError(err?.message || "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!meshyTaskId) return;
    let alive = true;
    let timer = null;

    async function tick() {
      try {
        const res = await fetch(`/api/3d/meshy-status?id=${encodeURIComponent(meshyTaskId)}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || data?.message || `조회 실패 (HTTP ${res.status})`);
        if (!alive) return;
        setMeshyStatus(data);
        const st = String(data?.status || "");
        if (st === "SUCCEEDED" || st === "FAILED" || st === "CANCELED") return;
        timer = setTimeout(tick, 2000);
      } catch (e) {
        if (!alive) return;
        setMeshyError(e?.message || "3D 상태 조회 실패");
        timer = setTimeout(tick, 3000);
      }
    }

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [meshyTaskId]);

  useEffect(() => {
    const st = String(meshyStatus?.status || "");
    if (st !== "SUCCEEDED") return;
    const stlUrl = meshyStatus?.modelUrls?.stl || "";
    if (!stlUrl) return;
    if (meshyAutoDownloaded) return;
    setMeshyAutoDownloaded(true);
    triggerDownload(stlUrl);
  }, [meshyStatus, meshyAutoDownloaded]);

  async function start3d() {
    if (!resultImageUrl) return;
    setMeshyLoading(true);
    setMeshyError("");
    setMeshyStatus(null);
    setMeshyTaskId("");
    setMeshyAutoDownloaded(false);
    try {
      const res = await fetch("/api/3d/meshy-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: resultImageUrl,
          enablePbr: false,
          shouldRemesh: true,
          shouldTexture: false,
          targetFormats: ["stl"],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || data?.message || `요청 실패 (HTTP ${res.status})`);
      setMeshyTaskId(data?.taskId || "");
    } catch (e) {
      setMeshyError(e?.message || "3D 변환 시작 실패");
    } finally {
      setMeshyLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Ceramic · Nano Banana 이미지 생성</title>
        <meta
          name="description"
          content="Gemini 3.1 Flash Image Preview (Nano Banana 2)로 프롬프트 기반 이미지 생성"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className={styles.snapRoot}>
        <section ref={topRef} className={styles.snapSection}>
          <div className={styles.sectionInner}>
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <Link className={styles.link} href="/archive">
                  Archive
                </Link>
              </div>

              <button type="button" className={styles.secondaryButton} onClick={scrollToResults}>
                Go to results
              </button>
            </div>

            <section className={styles.card}>
              <form onSubmit={onGenerate} className={styles.form}>
                <div className={styles.formBodyScroll}>
                  <div className={styles.checkIn}>
                    <div className={styles.checkInTop}>
                      <div className={styles.checkInTitle}>Daily check-in (5 questions)</div>
                      <button type="button" className={styles.secondaryButton} onClick={resetChat}>
                        Reset
                      </button>
                    </div>

                    <div className={styles.chat}>
                      {messages.map((m, idx) =>
                        m.role === "user" ? (
                          <div key={idx} className={styles.bubbleUser}>
                            {m.text}
                          </div>
                        ) : (
                          <div key={idx} className={styles.bubbleAssistant}>
                            {m.text}
                          </div>
                        ),
                      )}

                      <div className={styles.chatComposer}>
                        <input
                          className={styles.input}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Type your answer…"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              onSendMessage();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={!draft.trim()}
                          onClick={onSendMessage}
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>

                  <label className={styles.label}>
                    <span className={styles.labelText}>추가 요청(Optional)</span>
                    <input
                      className={styles.input}
                      value={optionalNotes}
                      onChange={(e) => setOptionalNotes(e.target.value)}
                      placeholder="예: more organic silhouette, crackle glaze, subtle speckle, softer highlights"
                    />
                  </label>

                <div className={styles.row}>
                  <label className={styles.labelInline}>
                    <span className={styles.labelText}>가로세로 비율</span>
                    <select
                      className={styles.select}
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value)}
                    >
                      {ASPECT_RATIOS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={styles.labelInline}>
                    <span className={styles.labelText}>해상도</span>
                    <select
                      className={styles.select}
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value)}
                    >
                      {RESOLUTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className={styles.toggles}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={includeText}
                      onChange={(e) => setIncludeText(e.target.checked)}
                    />
                    <span>텍스트 응답도 같이 받기</span>
                  </label>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={useSearchGrounding}
                      onChange={(e) => setUseSearchGrounding(e.target.checked)}
                    />
                    <span>Google Search grounding 사용</span>
                  </label>
                </div>
                </div>

                <div className={styles.formFooter}>
                  {error ? <div className={styles.error}>{error}</div> : null}

                  <button className={styles.primaryButton} type="submit" disabled={!canSubmit}>
                    {loading ? "Generating..." : "Generate image"}
                  </button>

                  <p className={styles.footerNote}>
                    생성된 이미지는 SynthID 워터마크가 포함될 수 있습니다. 실제 사용 전 정책/권리 확인을 권장합니다.
                  </p>
                </div>
              </form>
            </section>
          </div>
        </section>

        <section ref={resultsRef} className={styles.snapSection}>
          <div className={styles.sectionInner}>
            <div className={styles.sectionTitleRow}>
              <div>
                <h2 className={styles.sectionTitle}>결과</h2>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={scrollToTop}>
                Back to top
              </button>
            </div>

            <div className={styles.resultsGrid}>
              <section className={styles.card}>
                <h3 className={styles.cardTitle}>이미지 · 3D(STL)</h3>
                <div className={styles.result}>
                  {resultImageUrl ? (
                    <div className={styles.imagePane}>
                      <div className={styles.resultTopRow}>
                        <div className={styles.imageFrame}>
                          <img className={styles.image} src={resultImageUrl} alt="generated" />
                        </div>

                        <div className={styles.threeDBox}>
                          <div className={styles.threeDHeader}>
                            <div className={styles.threeDTitle}>3D 변환</div>
                            <div className={styles.threeDSub}>Meshy · 이미지→3D · STL만</div>
                          </div>

                          {meshyError ? <div className={styles.error}>{meshyError}</div> : null}

                          {meshyStatus ? (
                            <div className={styles.threeDStatus}>
                              <div className={styles.threeDRow}>
                                <div className={styles.threeDLabel}>상태</div>
                                <div className={styles.threeDValue}>{meshyStatus.status}</div>
                              </div>
                              {meshyStatus.progress != null ? (
                                <div className={styles.threeDRow}>
                                  <div className={styles.threeDLabel}>진행</div>
                                  <div className={styles.threeDValue}>{meshyStatus.progress}%</div>
                                </div>
                              ) : null}
                              {meshyAutoDownloaded && meshyStatus?.modelUrls?.stl ? (
                                <div className={styles.threeDRow}>
                                  <div className={styles.threeDLabel}>Download</div>
                                  <div className={styles.threeDValue}>Auto-downloaded STL.</div>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className={styles.threeDHint}>
                              STL은 텍스쳐 없이 메시만 받습니다. (권장: 입력 이미지 512/1K)
                            </div>
                          )}

                          <div className={styles.threeDActions}>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={start3d}
                              disabled={!resultImageUrl || meshyLoading}
                            >
                              {meshyLoading ? "Starting..." : "Generate STL"}
                            </button>
                            {meshyTaskId ? (
                              <div
                                className={styles.mono}
                                style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)" }}
                              >
                                task: {meshyTaskId}
                              </div>
                            ) : null}
                          </div>

                          {meshyStatus?.modelUrls?.stl ? (
                            <div className={styles.threeDLinks}>
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => triggerDownload(meshyStatus.modelUrls.stl)}
                              >
                                Download STL again
                              </button>
                            </div>
                          ) : null}

                          {meshyStatus?.thumbnailUrl ? (
                            <div className={styles.threeDThumb}>
                              <img className={styles.image} src={meshyStatus.thumbnailUrl} alt="3d preview" />
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className={styles.resultActions}>
                        <a className={styles.secondaryButton} href={resultImageUrl} download="nano-banana.png">
                          Download image
                        </a>
                        {archiveInfo?.drive?.webViewLink ? (
                          <a
                            className={styles.secondaryButton}
                            href={archiveInfo.drive.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View in Drive
                          </a>
                        ) : null}
                        {archiveInfo?.id ? (
                          <Link className={styles.secondaryButton} href="/archive">
                            View archive
                          </Link>
                        ) : null}
                      </div>
                      {archiveInfo?.driveError ? (
                        <div style={{ marginTop: "0.75rem" }}>
                          <div className={styles.error}>
                            Drive upload failed: {archiveInfo.driveError}
                          </div>
                          {String(archiveInfo.driveError).includes("서비스 계정") ? (
                            <div style={{ marginTop: "0.5rem" }}>
                              <button type="button" className={styles.secondaryButton} onClick={connectDrive}>
                                Connect Google Drive (OAuth)
                              </button>
                              {driveConnectError ? (
                                <div className={styles.error} style={{ marginTop: "0.5rem" }}>
                                  {driveConnectError}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className={styles.imagePane}>
                      <div className={styles.placeholder}>아직 결과가 없습니다. 위에서 생성 후 내려오면 표시됩니다.</div>
                    </div>
                  )}
                </div>
              </section>

              <section className={styles.card}>
                <h3 className={styles.cardTitle}>프롬프트/텍스트</h3>

                {translatedEn ? (
                  <div className={`${styles.textBlock} ${styles.textBlockTall}`}>
                    <div className={styles.textBlockTitle}>번역(영어)</div>
                    <pre className={styles.pre}>{translatedEn}</pre>
                  </div>
                ) : (
                  <div className={styles.placeholder}>이미지 생성 후 번역/CMF 프롬프트가 표시됩니다.</div>
                )}

                {cmfPromptEn ? (
                  <div className={`${styles.textBlock} ${styles.textBlockTall}`}>
                    <div className={styles.textBlockTitle}>CMF 최종 프롬프트(영어)</div>
                    <pre className={styles.pre}>{cmfPromptEn}</pre>
                  </div>
                ) : null}

                {resultText ? (
                  <div className={`${styles.textBlock} ${styles.textBlockTall}`}>
                    <div className={styles.textBlockTitle}>텍스트 응답</div>
                    <pre className={styles.pre}>{resultText}</pre>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
