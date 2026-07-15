import { Button, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { BATCH_COLOR } from "@/colors";
import type { ImportBatch } from "@/api/types";

export function ImportPage() {
  const state = useAsync(() => api.listImportBatches(), []);
  const { label } = useLabels();

  const columns: ColumnsType<ImportBatch> = [
    { title: "批次名称", dataIndex: "name", key: "name" },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      render: (v: string) => label("ImportType", v),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <EnumTag enumName="BatchStatus" value={v} colorMap={BATCH_COLOR} />
      ),
    },
    { title: "输入数", dataIndex: "input_count", key: "input_count", align: "right" },
    { title: "图片数", dataIndex: "image_count", key: "image_count", align: "right" },
    {
      title: "抽帧任务",
      dataIndex: "frame_task_count",
      key: "frame_task_count",
      align: "right",
    },
    {
      title: "错误",
      dataIndex: "error_count",
      key: "error_count",
      align: "right",
      render: (v: number) => (v > 0 ? <span style={{ color: "#ff7875" }}>{v}</span> : v),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
  ];

  return (
    <>
      <PageHeader
        title="导入"
        subtitle="导入批次与来源"
        extra={
          <Tooltip title="接入后端后可发起新导入">
            <Button type="primary" disabled>
              新建导入
            </Button>
          </Tooltip>
        }
      />
      <AsyncBoundary state={state}>
        {(batches) => (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={batches}
            pagination={false}
            size="middle"
          />
        )}
      </AsyncBoundary>
    </>
  );
}
