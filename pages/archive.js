import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "@/styles/Home.module.css";

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR");
}

function groupLabelForItem(it) {
  return it?.groupLabel || it?.inputs?.material || "unknown";
}

export default function ArchivePage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/archive?limit=500");
        const data = await res.json().catch(() => null);
        if (!res.ok)
          throw new Error(data?.error?.message || data?.error || `요청 실패 (HTTP ${res.status})`);
        if (alive) setItems(data?.items || []);
      } catch (e) {
        if (alive) setError(e?.message || "로딩 실패");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = it.groupKey || "unknown";
      const label = groupLabelForItem(it);
      if (!map.has(key)) map.set(key, { key, label, count: 0 });
      map.get(key).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [items]);

  const visible = useMemo(() => {
    if (activeGroup === "all") return items;
    return items.filter((it) => (it.groupKey || "unknown") === activeGroup);
  }, [items, activeGroup]);

  const countLabel = useMemo(() => `${visible.length}개`, [visible.length]);

  return (
    <>
      <Head>
        <title>Ceramic · 아카이빙</title>
        <meta name="description" content="생성된 CMF 구 샘플 아카이빙" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className={styles.archiveMain}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Link className={styles.link} href="/">
              생성기로
            </Link>
            <div>
              <h1 className={styles.title}>아카이빙</h1>
              <p className={styles.lead}>표시 중: {countLabel}</p>
            </div>
          </div>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.archiveFilters}>
          <button
            type="button"
            className={`${styles.capsule} ${activeGroup === "all" ? styles.capsuleSelected : ""}`}
            onClick={() => setActiveGroup("all")}
          >
            전체({items.length})
          </button>
          {groups.slice(0, 18).map((g) => (
            <button
              key={g.key}
              type="button"
              className={`${styles.capsule} ${activeGroup === g.key ? styles.capsuleSelected : ""}`}
              onClick={() => setActiveGroup(g.key)}
              title={g.label}
            >
              {g.label}({g.count})
            </button>
          ))}
        </div>

        {loading ? (
          <div className={styles.placeholder}>불러오는 중...</div>
        ) : visible.length ? (
          <div className={styles.masonry}>
            {visible.map((it) => (
              <button
                key={it.id}
                type="button"
                className={styles.pin}
                onClick={() => setSelected(it)}
                title={it.name}
              >
                <div className={styles.pinMedia}>
                  <img className={styles.image} src={it.imageUrl} alt={it.name || it.id} />
                </div>
                <div className={styles.pinMeta}>
                  <div className={styles.pinTitle}>{it.name || it.id}</div>
                  <div className={styles.pinSub}>{formatTime(it.createdAt)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.placeholder}>아직 저장된 결과가 없습니다.</div>
        )}

        {selected ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="아카이브 상세">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{selected.name || selected.id}</div>
                <button type="button" className={styles.modalClose} onClick={() => setSelected(null)}>
                  닫기
                </button>
              </div>

              <div className={styles.modalTwoCol}>
                <div className={styles.imageFrame} style={{ height: 340 }}>
                  <img className={styles.image} src={selected.imageUrl} alt={selected.name || selected.id} />
                </div>
                <div className={styles.modalInfo}>
                  <div className={styles.modalInfoRow}>
                    <div className={styles.modalInfoLabel}>그룹</div>
                    <div className={styles.modalInfoValue}>{groupLabelForItem(selected)}</div>
                  </div>
                  {selected.inputs?.color ? (
                    <div className={styles.modalInfoRow}>
                      <div className={styles.modalInfoLabel}>색</div>
                      <div className={styles.modalInfoValue}>{selected.inputs.color}</div>
                    </div>
                  ) : null}
                  {selected.inputs?.surfaceDetail ? (
                    <div className={styles.modalInfoRow}>
                      <div className={styles.modalInfoLabel}>요철</div>
                      <div className={styles.modalInfoValue}>{selected.inputs.surfaceDetail}</div>
                    </div>
                  ) : null}

                  <div className={styles.modalActions}>
                    {selected.drive?.webViewLink ? (
                      <a
                        className={styles.secondaryButton}
                        href={selected.drive.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Drive에서 보기
                      </a>
                    ) : null}
                    <a className={styles.secondaryButton} href={selected.imageUrl} target="_blank" rel="noreferrer">
                      원본 열기
                    </a>
                  </div>

                  {selected.promptCmf ? (
                    <div className={styles.textBlock} style={{ maxHeight: "34vh" }}>
                      <div className={styles.textBlockTitle}>CMF 최종 프롬프트(영어)</div>
                      <pre className={styles.pre}>{selected.promptCmf}</pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}

