import { useMemo, useState } from "react";
import { Image } from "antd";

interface ThumbnailProps {
  /** 用于生成确定性占位色块的种子（无真实图片时回退）。 */
  seed: string;
  /** 图片 ID；提供后优先渲染真实图片 /api/images/{id}/raw，失败回退占位。 */
  imageId?: string;
  /** 是否启用点击全屏预览（需配合 imageId）。 */
  preview?: boolean;
  size?: number;
  ratio?: number;
}

/** 优先渲染真实图片，加载失败时由种子哈希生成确定性渐变色块占位。 */
export function Thumbnail({ seed, imageId, preview = false, size = 160, ratio = 1 }: ThumbnailProps) {
  const [failed, setFailed] = useState(false);
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

  const width = size;
  const height = size / ratio;
  const src = imageId ? `/api/images/${encodeURIComponent(imageId)}/raw` : "";

  if (imageId && !failed && preview) {
    return (
      <Image
        src={src}
        alt={hint}
        width={width}
        height={height}
        onError={() => setFailed(true)}
        style={{ borderRadius: 6, objectFit: "cover", background: "#1b1e26" }}
        preview={{ mask: "预览" }}
      />
    );
  }

  if (imageId && !failed) {
    return (
      <img
        src={src}
        alt={hint}
        onError={() => setFailed(true)}
        style={{
          width,
          height,
          borderRadius: 6,
          objectFit: "cover",
          background: "#1b1e26",
          display: "block",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width,
        height,
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
