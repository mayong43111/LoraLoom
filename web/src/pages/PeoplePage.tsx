import { useState } from "react";
import { Card, Col, Descriptions, List, Row, Space, Statistic } from "antd";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import { PERSON_COLOR } from "@/colors";
import type { PersonCluster } from "@/api/types";

function PeopleContent({ people }: { people: PersonCluster[] }) {
  const [selectedId, setSelectedId] = useState(people[0]?.id);
  const selected = people.find((p) => p.id === selectedId) ?? people[0];

  return (
    <Row gutter={16}>
      <Col xs={24} md={9}>
        <Card title="人物聚类" size="small">
          <List
            dataSource={people}
            renderItem={(person) => (
              <List.Item
                onClick={() => setSelectedId(person.id)}
                style={{
                  cursor: "pointer",
                  background: person.id === selected?.id ? "#232733" : undefined,
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {person.display_name}
                      <EnumTag
                        enumName="PersonStatus"
                        value={person.status}
                        colorMap={PERSON_COLOR}
                      />
                    </Space>
                  }
                  description={
                    <span style={{ fontSize: 12, color: "#8b90a0" }}>
                      {person.image_count} 张 · {person.face_count} 张脸
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} md={15}>
        {selected && (
          <Card title={selected.display_name} size="small">
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Statistic title="正面" value={selected.front_count} />
              </Col>
              <Col span={8}>
                <Statistic title="侧面" value={selected.side_count} />
              </Col>
              <Col span={8}>
                <Statistic title="背面" value={selected.back_count} />
              </Col>
            </Row>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="状态">
                <EnumTag
                  enumName="PersonStatus"
                  value={selected.status}
                  colorMap={PERSON_COLOR}
                />
              </Descriptions.Item>
              <Descriptions.Item label="图片数">
                {selected.image_count}
              </Descriptions.Item>
              <Descriptions.Item label="人脸数">
                {selected.face_count}
              </Descriptions.Item>
              <Descriptions.Item label="疑似重复于">
                {selected.suspected_duplicate_of ?? "无"}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}
      </Col>
    </Row>
  );
}

export function PeoplePage() {
  const state = useAsync(() => api.listPeople(), []);
  return (
    <>
      <PageHeader title="人物" subtitle="人物聚类与统计" />
      <AsyncBoundary state={state}>
        {(people) => <PeopleContent people={people} />}
      </AsyncBoundary>
    </>
  );
}
