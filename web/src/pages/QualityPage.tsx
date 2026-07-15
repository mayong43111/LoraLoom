import { useState } from "react";
import { Card, Col, Empty, List, Row, Statistic, Tag } from "antd";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { Thumbnail } from "@/components/Thumbnail";
import type { DatasetStats } from "@/api/types";

function QualityContent({ stats }: { stats: DatasetStats }) {
  const { label } = useLabels();
  const entries = Object.entries(stats.quality_distribution);
  const [flag, setFlag] = useState<string | undefined>(entries[0]?.[0]);

  const imagesState = useAsync(
    () => api.listImages(flag ? { quality_flag: flag } : {}),
    [flag],
  );

  return (
    <Row gutter={16}>
      <Col xs={24} md={8}>
        <Card title="问题类型" size="small">
          <List
            dataSource={entries}
            renderItem={([value, count]) => (
              <List.Item
                onClick={() => setFlag(value)}
                style={{
                  cursor: "pointer",
                  background: value === flag ? "#232733" : undefined,
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                <span>{label("QualityFlag", value)}</span>
                <Tag>{count}</Tag>
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} md={16}>
        <Card
          title={flag ? `问题预览 · ${label("QualityFlag", flag)}` : "问题预览"}
          size="small"
          extra={
            <Statistic
              value={imagesState.data?.length ?? 0}
              valueStyle={{ fontSize: 16 }}
              suffix="张"
            />
          }
        >
          <AsyncBoundary state={imagesState}>
            {(images) =>
              images.length === 0 ? (
                <Empty description="无此类问题图片" />
              ) : (
                <Row gutter={[12, 12]}>
                  {images.slice(0, 24).map((image) => (
                    <Col key={image.id}>
                      <Thumbnail seed={image.thumbnail_hint || image.id} size={110} />
                    </Col>
                  ))}
                </Row>
              )
            }
          </AsyncBoundary>
        </Card>
      </Col>
    </Row>
  );
}

export function QualityPage() {
  const state = useAsync(() => api.getStats(), []);
  return (
    <>
      <PageHeader title="质量" subtitle="质检问题分布与样本预览" />
      <AsyncBoundary state={state}>
        {(stats) => <QualityContent stats={stats} />}
      </AsyncBoundary>
    </>
  );
}
