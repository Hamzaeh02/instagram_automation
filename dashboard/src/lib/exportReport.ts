export interface ReportItem {
  platform: string
  caption: string
  published_at: string | null
  media_type: string
  available: boolean
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  engagement_rate: number | null
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
}

const PLATFORM_RGB: Record<string, [number, number, number]> = {
  instagram: [193, 53, 132],
  facebook: [24, 119, 242],
  youtube: [230, 33, 23],
  tiktok: [17, 17, 17],
  linkedin: [10, 102, 194],
  x: [17, 17, 17],
}

const GREEN: [number, number, number] = [95, 138, 44]
const INK: [number, number, number] = [33, 31, 26]
const MUTED: [number, number, number] = [107, 101, 88]

// jsPDF's built-in fonts only cover Latin-1, so emoji and other symbols
// would print as garbage - drop them rather than corrupt the caption.
function clean(text: string, max = 80) {
  const flat = text.replace(/\s+/g, " ").replace(/[^\x20-\xFF]/g, "").trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat || "(no caption)"
}

function num(n: number | null) {
  return n === null ? "-" : n.toLocaleString("en-US")
}

function compact(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return n.toLocaleString("en-US")
}

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"
}

export async function exportPostReport(opts: { items: ReportItem[]; workspaceName: string; scope: string }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  const items = opts.items
  const withStats = items.filter((i) => i.available)
  const sum = (k: "views" | "likes" | "comments" | "shares") => withStats.reduce((n, i) => n + (i[k] ?? 0), 0)
  const rates = withStats.map((i) => i.engagement_rate).filter((r): r is number => r !== null)
  const avgEng = rates.length ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2) + "%" : "-"
  const dates = items.map((i) => i.published_at).filter((d): d is string => Boolean(d)).sort()

  // Header band
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, W, 96, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(20)
  doc.text("Post performance report", M, 44)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text(`${clean(opts.workspaceName, 60)}  ·  ${opts.scope}`, M, 64)
  doc.text(
    `${dates.length ? `${date(dates[0])} - ${date(dates[dates.length - 1])}` : "No dates"}  ·  Generated ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    M,
    80,
  )
  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.text("Reelmind", W - M, 44, { align: "right" })

  // KPI tiles
  const kpis = [
    ["Posts", items.length.toLocaleString("en-US")],
    ["Views", compact(sum("views"))],
    ["Likes", compact(sum("likes"))],
    ["Comments", compact(sum("comments"))],
    ["Shares", compact(sum("shares"))],
    ["Avg. engagement", avgEng],
  ]
  const gap = 8
  const tileW = (W - M * 2 - gap * (kpis.length - 1)) / kpis.length
  let y = 120
  kpis.forEach(([label, value], i) => {
    const x = M + i * (tileW + gap)
    doc.setFillColor(246, 245, 240)
    doc.roundedRect(x, y, tileW, 54, 6, 6, "F")
    doc.setTextColor(...INK)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(15)
    doc.text(value, x + 10, y + 26)
    doc.setTextColor(...MUTED)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.text(label, x + 10, y + 42)
  })
  y += 78

  const sectionTitle = (title: string) => {
    doc.setTextColor(...INK)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.text(title, M, y)
    y += 8
  }

  const tableStyle = {
    theme: "grid" as const,
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: [228, 225, 216] as [number, number, number], lineWidth: 0.5 },
    headStyles: { fillColor: [33, 31, 26] as [number, number, number], textColor: 255, fontStyle: "bold" as const },
    alternateRowStyles: { fillColor: [250, 249, 245] as [number, number, number] },
  }

  // By platform
  sectionTitle("By platform")
  const platforms = [...new Set(items.map((i) => i.platform))]
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [["Platform", "Posts", "Views", "Likes", "Comments", "Shares", "Avg. engagement"]],
    body: platforms.map((p) => {
      const list = items.filter((i) => i.platform === p)
      const s = list.filter((i) => i.available)
      // "-" when the platform didn't report this metric for any post, so a
      // missing number never reads as a real zero.
      const tot = (k: "views" | "likes" | "comments" | "shares") =>
        s.some((i) => i[k] !== null) ? num(s.reduce((n, i) => n + (i[k] ?? 0), 0)) : "-"
      const r = s.map((i) => i.engagement_rate).filter((v): v is number => v !== null)
      return [
        PLATFORM_LABEL[p] ?? p,
        list.length,
        tot("views"),
        tot("likes"),
        tot("comments"),
        tot("shares"),
        r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(2) + "%" : "-",
      ]
    }),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 26

  // Top 10 chart
  const top = [...withStats].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 10)
  if (top.length) {
    sectionTitle("Top posts by views")
    y += 6
    const max = Math.max(...top.map((t) => t.views ?? 0), 1)
    const labelW = 190
    const barMax = W - M * 2 - labelW - 60
    doc.setFontSize(8)
    top.forEach((t) => {
      doc.setTextColor(...MUTED)
      doc.setFont("helvetica", "normal")
      doc.text(clean(t.caption, 38), M, y + 9)
      const w = Math.max(2, ((t.views ?? 0) / max) * barMax)
      doc.setFillColor(...(PLATFORM_RGB[t.platform] ?? GREEN))
      doc.roundedRect(M + labelW, y, w, 12, 3, 3, "F")
      doc.setTextColor(...INK)
      doc.setFont("helvetica", "bold")
      doc.text(compact(t.views ?? 0), M + labelW + w + 6, y + 9)
      y += 19
    })
    y += 18
  }

  // Top 5 detail
  if (top.length) {
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    sectionTitle("Top 5 posts")
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [["#", "Post", "Platform", "Views", "Likes", "Comments", "Eng."]],
      body: top.slice(0, 5).map((t, i) => [
        i + 1,
        clean(t.caption, 60),
        PLATFORM_LABEL[t.platform] ?? t.platform,
        num(t.views),
        num(t.likes),
        num(t.comments),
        t.engagement_rate !== null ? t.engagement_rate + "%" : "-",
      ]),
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 210 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    })
  }

  // All posts
  doc.addPage()
  y = 50
  sectionTitle(`All posts (${items.length})`)
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [["Date", "Platform", "Post", "Views", "Likes", "Comm.", "Shares", "Eng."]],
    body: items.map((t) => [
      date(t.published_at),
      PLATFORM_LABEL[t.platform] ?? t.platform,
      clean(t.caption, 70),
      t.available ? num(t.views) : "-",
      t.available ? num(t.likes) : "-",
      t.available ? num(t.comments) : "-",
      t.available ? num(t.shares) : "-",
      t.engagement_rate !== null ? t.engagement_rate + "%" : "-",
    ]),
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 54 },
      2: { cellWidth: 170 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
    },
  })

  // Footer on every page
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    const H = doc.internal.pageSize.getHeight()
    doc.setDrawColor(228, 225, 216)
    doc.line(M, H - 34, W - M, H - 34)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text("Generated by Reelmind · numbers as reported by each platform", M, H - 20)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: "right" })
  }

  const slug = opts.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reelmind"
  const now = new Date()
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  doc.save(`${slug}-post-report-${localDate}.pdf`)
}
