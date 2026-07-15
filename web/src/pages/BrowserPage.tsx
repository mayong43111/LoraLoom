import { Placeholder } from "@/components/Placeholder";
import { PageHeader } from "@/components/PageHeader";

export function BrowserPage() {
  return (
    <>
      <PageHeader title="内置浏览器" subtitle="网页素材采集" />
      <Placeholder
        title="内置浏览器采集"
        phase="第二阶段"
        description="用于在应用内浏览网页并捕获图片/视频素材。该能力规划在第二阶段，当前不可用。"
      />
    </>
  );
}
