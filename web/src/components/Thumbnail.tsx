import { useMemo } from "react";

interface ThumbnailProps {
  /** 用于生成确定性占位色块的种子（mock 环境无真实图片）。 */
  seed: string;
  size?: number;
  ratio?: number;
}

/** 由种子哈希生成确定性渐变色块，作为图片缩略图占位。 */
export function Thumbnail({ seed, size = 160, ratio = 1 }: ThumbnailProps) {
  const { from, to, hint } = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 40) % 360;
    return {
      from: `hsl(${h1}, 45%, 42%)`,
      to: `hsl(${h2}, 45%, 28%)`,
      hint: seed.slice(-4).toUpperCase(),
    };
  }, [seed]);

  return (
    <div
      style={{
        width: size,
        height: size / ratio,
        borderRadius: 6,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,0.72)",
        fontSize: 12,
        letterSpacing: 1,
        fontFamily: "monospace",
        userSelect: "none",
      }}
    >
      {hint}
    </div>
  );
}
