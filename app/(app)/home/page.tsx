import Link from "next/link";
import { RecentScene } from "@/components/RecentScene";
import { SceneCard } from "@/components/SceneCard";
import { Sheet } from "@/components/Sheet";
import { READY_SCENES } from "@/lib/scenes";

/** 포털에서 들어오는 자리. 소개 페이지를 거치지 않는다 */
export default function HomePage() {
  const featured = READY_SCENES.filter((s) => s.featured);

  return (
    <>
      <Sheet
        tone="dark"
        point
        eyebrow="HOME"
        headline={
          <>
            오늘은 어떤 장면으로
            <br />
            잠깐 쉬어 볼까요?
          </>
        }
        lead="물감, 물결, 별, 공, 슬라임. 만지면 움직이고, 손을 떼면 천천히 잔잔해져요. 정답도 점수도 없어요."
      >
        <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
          <Link className="btn btn--primary" href="/scenes">
            장면 고르기 →
          </Link>
        </div>
      </Sheet>

      <RecentScene />

      <Sheet point eyebrow="PICK ONE" headline="가볍게 시작하기 좋은 장면">
        <div className="scene-grid">
          {featured.map((s) => (
            <SceneCard key={s.slug} scene={s} />
          ))}
        </div>
      </Sheet>

      <Sheet tone="tint" eyebrow="HOW TO TOUCH" headline="이렇게 만져요">
        <ul className="tip-list">
          <li>
            <strong>움직이기</strong> 마우스를 움직이거나 손가락으로 문지르면 그 자리에서 번져요. 여러 손가락도 돼요.
          </li>
          <li>
            <strong>스크롤</strong> 마우스 휠을 밀면 장면이 그쪽으로 밀려요.
          </li>
          <li>
            <strong>기울이기</strong> 폰에서 <em>기울기</em>를 켜면 기울인 쪽으로 화면 전체가 천천히 흘러요.
          </li>
          <li>
            <strong>가만히</strong> 손을 떼고 두면 몇 초에 한 번 스스로 조금씩 움직여요. <em>흐름</em>을 끄면 멈춰요.
          </li>
        </ul>
      </Sheet>
    </>
  );
}
