import { useState } from "react";
import { Card, Col, List, Progress, Row, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { FRAME_COLOR } from "@/colors";
import type { FrameJob, FrameResult } from "@/api/types";

function FrameTable({ job }: { job: FrameJob }) {
  const columns: ColumnsType<FrameResult> = [
    {
      title: "目标时间(s)",
      dataIndex: "target_timestamp",
      key: "target",
      render: (v: number) => v.toFixed(1),
    },
    {
      title: "实际时间(s)",
      dataIndex: "actual_timestamp",
      key: "actual",
      render: (v: number | null) => (v == null ? "-" : v.toFixed(2)),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <EnumTag enumName="FrameStatus" value={v} colorMap={FRAME_COLOR} />
      ),
    },
    {
      title: "质量分",
      dataIndex: "quality_score",
      key: "quality",
      render: (v: number | null) => (v == null ? "-" : v.toFixed(2)),
    },
  ];
  return (
    <Table
      rowKey={(r) => `${job.id}-${r.target_timestamp}`}
      columns={columns}
      dataSource={job.frames}
      pagination={false}
      size="small"
    />
  );
}

function FramesContent({ jobs }: { jobs: FrameJob[] }) {
  const [selectedId, setSelectedId] = useState(jobs[0]?.id);
  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0];

  return (
    <Row gutter={16}>
      <Col xs={24} md={8}>
        <Card title="视频任务" size="small">
          <List
            dataSource={jobs}
            renderItem={(job) => (
              <List.Item
                onClick={() => setSelectedId(job.id)}
                style={{
                  cursor: "pointer",
                  background: job.id === selected?.id ? "#232733" : undefined,
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <List.Item.Meta
                  title={job.video_name}
                  description={
                    <>
                      <div style={{ fontSize: 12, color: "#8b90a0" }}>
                        时长 {job.duration.toFixed(0)}s · 间隔 {job.interval}s
                      </div>
                      <Progress
                        percent={Math.round(job.progress * 100)}
                        size="small"
                      />
                    </>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} md={16}>
        <Card title={selected ? `抽帧结果 · ${selected.video_name}` : "抽帧结果"} size="small">
          {selected && <FrameTable job={selected} />}
        </Card>
      </Col>
    </Row>
  );
}

export function FramesPage() {
  const state = useAsync(() => api.listFrameJobs(), []);
  return (
    <>
      <PageHeader title="视频抽帧" subtitle="按间隔抽帧并做邻近帧择优" />
      <AsyncBoundary state={state}>
        {(jobs) => <FramesContent jobs={jobs} />}
      </AsyncBoundary>
    </>
  );
}
