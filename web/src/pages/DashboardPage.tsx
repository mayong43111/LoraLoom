import { Card, Col, Progress, Row, Statistic } from "antd";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import type { DatasetStats } from "@/api/types";

function DistributionCard({
  title,
  enumName,
  data,
}: {
  title: string;
  enumName: string;
  data: Record<string, number>;
}) {
  const { label } = useLabels();
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  return (
    <Card title={title} size="small">
      {Object.entries(data).map(([value, count]) => (
        <div key={value} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{label(enumName, value)}</span>
            <span style={{ color: "#8b90a0" }}>{count}</span>
          </div>
          <Progress
            percent={Math.round((count / total) * 100)}
            showInfo={false}
            size="small"
          />
        </div>
      ))}
    </Card>
  );
}

function DashboardContent({ stats }: { stats: DatasetStats }) {
  const primary = [
    { title: "图片总数", value: stats.image_total },
    { title: "待复核候选", value: stats.image_candidate },
    { title: "已复核", value: stats.image_reviewed },
    { title: "可导出", value: stats.image_exportable },
    { title: "已拒绝", value: stats.image_rejected },
    { title: "人物数", value: stats.person_total },
  ];
  const pending = [
    { title: "待抽帧", value: stats.pending_frame },
    { title: "待质检", value: stats.pending_quality },
    { title: "待人脸处理", value: stats.pending_face },
    { title: "待复核", value: stats.pending_review },
  ];

  return (
    <>
      <Row gutter={[16, 16]}>
        {primary.map((item) => (
          <Col key={item.title} xs={12} sm={8} md={4}>
            <Card size="small">
              <Statistic title={item.title} value={item.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <DistributionCard
            title="朝向分布"
            enumName="Orientation"
            data={stats.orientation_distribution}
          />
        </Col>
        <Col xs={24} md={8}>
          <DistributionCard
            title="质量问题分布"
            enumName="QualityFlag"
            data={stats.quality_distribution}
          />
        </Col>
        <Col xs={24} md={8}>
          <Card title="待处理队列" size="small">
            <Row gutter={[8, 16]}>
              {pending.map((item) => (
                <Col span={12} key={item.title}>
                  <Statistic
                    title={item.title}
                    value={item.value}
                    valueStyle={{ fontSize: 20 }}
                  />
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </>
  );
}

export function DashboardPage() {
  const state = useAsync(() => api.getStats(), []);
  return (
    <>
      <PageHeader title="概览" subtitle="数据集整体状态与待处理队列" />
      <AsyncBoundary state={state}>
        {(stats) => <DashboardContent stats={stats} />}
      </AsyncBoundary>
    </>
  );
}
