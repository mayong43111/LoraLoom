import { Progress, Table, Tooltip } from "antd";
import { Link } from "react-router-dom";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { DOWNLOAD_COLOR } from "@/colors";
import type { DownloadTask } from "@/api/types";

export function DownloadsPage() {
  const state = useAsync(
    () => Promise.all([api.listDownloads(), api.listVideos()]),
    [],
  );
  const { label } = useLabels();

  const buildColumns = (
    videoByDownload: Map<string, string>,
  ): ColumnsType<DownloadTask> => [
    { title: "标题", dataIndex: "title", key: "title", ellipsis: true },
    {
      title: "下载器",
      dataIndex: "tool",
      key: "tool",
      render: (v: string) => label("DownloadTool", v),
    },
    { title: "质量", dataIndex: "quality", key: "quality" },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <EnumTag enumName="DownloadStatus" value={v} colorMap={DOWNLOAD_COLOR} />
      ),
    },
    {
      title: "进度",
      dataIndex: "progress",
      key: "progress",
      width: 200,
      render: (v: number, row) => (
        <Progress
          percent={Math.round(v * 100)}
          size="small"
          status={row.status === "failed" ? "exception" : undefined}
        />
      ),
    },
    { title: "速度", dataIndex: "speed", key: "speed" },
    {
      title: "视频库",
      key: "video",
      width: 120,
      render: (_: unknown, row) => {
        const videoId = videoByDownload.get(row.id);
        return videoId ? (
          <Link to="/videos">已入库</Link>
        ) : (
          <Tooltip title="下载完成的视频会自动进入视频库">
            <span style={{ color: "#8b90a0" }}>—</span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="下载" subtitle="下载任务队列（视频完成后自动进入视频库）" />
      <AsyncBoundary state={state}>
        {([tasks, videos]) => {
          const videoByDownload = new Map<string, string>();
          for (const v of videos) {
            if (v.source_download_id) videoByDownload.set(v.source_download_id, v.id);
          }
          return (
            <Table
              rowKey="id"
              columns={buildColumns(videoByDownload)}
              dataSource={tasks}
              pagination={false}
              size="middle"
            />
          );
        }}
      </AsyncBoundary>
    </>
  );
}
