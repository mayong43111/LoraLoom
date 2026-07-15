import { Progress, Table } from "antd";
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
  const state = useAsync(() => api.listDownloads(), []);
  const { label } = useLabels();

  const columns: ColumnsType<DownloadTask> = [
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
  ];

  return (
    <>
      <PageHeader title="下载" subtitle="下载任务队列" />
      <AsyncBoundary state={state}>
        {(tasks) => (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={tasks}
            pagination={false}
            size="middle"
          />
        )}
      </AsyncBoundary>
    </>
  );
}
