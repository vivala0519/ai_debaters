import { PROVIDERS, type DebateRequest, type DebateRound, type ProviderId } from "../debate";

function clip(value: string, limit: number) {
  return value.replace(/\s+/g, " ").slice(0, limit) + (value.length > limit ? "…" : "");
}

/** Deliberately templated examples. These are never presented as API responses. */
export function createDemoMessage(input: DebateRequest, providerId: ProviderId, round: DebateRound): string {
  const topic = clip(input.topic, 100);
  const thesis = clip(input.position, 160);
  const others = PROVIDERS.filter((provider) => provider.id !== providerId).map((provider) => provider.name);
  const prefix = "[데모 예시 · 실제 AI 응답이 아닙니다]\n\n";
  const opening: Record<ProviderId, string> = {
    gpt: `핵심 주장\n「${topic}」에 대해 사용자는 “${thesis}”라는 입론을 제시했습니다. 이 주장에 힘을 실으려면 결론과 이를 뒷받침하는 근거를 구분해야 합니다.\n\n검토할 근거\n기대하는 효과가 어떤 과정을 통해 발생하는지 먼저 정의하고, 현재 방식과 비교해 판단할 지표를 정하는 접근을 제안합니다.\n\n남은 질문\n어떤 관찰 결과가 나오면 이 주장을 수정할 수 있을까요?`,
    claude: `핵심 주장\n「${topic}」의 입론 “${thesis}”에는 더 살펴볼 전제가 있습니다. 주장의 취지에 동의하더라도 모든 상황에 같은 결론을 적용할 수 있는지는 별도 문제입니다.\n\n검토할 근거\n혜택을 얻는 사람과 비용을 부담하는 사람이 같은지, 예외에 해당하는 사례는 무엇인지 검토해야 합니다.\n\n남은 질문\n가장 불리한 조건에서도 이 입론을 유지할 수 있을까요?`,
    gemini: `핵심 주장\n「${topic}」에 관한 “${thesis}”를 판단하려면 선택지를 더 구체화할 필요가 있습니다. 전면 도입과 전면 거부 사이에도 실험 가능한 대안이 있을 수 있습니다.\n\n검토할 근거\n작은 범위에서 실행하고 결과를 비교해 확대 여부를 결정하는 방법을 고려할 수 있습니다. 이 예시는 실제 자료나 통계를 조회한 결과가 아닙니다.\n\n남은 질문\n가장 작게 검증할 수 있는 실행 단위는 무엇일까요?`,
  };
  const rebuttal: Record<ProviderId, string> = {
    gpt: `${others[0]}의 전제 검토에 대하여\n예외와 비용을 점검하자는 지적은 타당합니다. 다만 예외가 있다는 사실만으로 “${topic}”에 관한 사용자 주장을 기각할 수는 없습니다. 예외의 빈도와 영향도 함께 평가해야 합니다.\n\n${others[1]}의 실험 제안에 대하여\n작게 검증하자는 접근은 유용하지만, 무엇을 성공으로 볼지 정하지 않으면 결과를 원하는 방향으로 해석할 수 있습니다.\n\n수정 제안\n입론 “${thesis}”의 효과와 부작용을 같은 기준으로 비교합시다.`,
    claude: `${others[0]}의 근거 중심 접근에 대하여\n측정할 지표를 정하는 것만으로 충분하지 않습니다. “${topic}”에서 측정하기 쉬운 가치가 다른 가치를 밀어낼 수 있습니다.\n\n${others[1]}의 단계적 접근에 대하여\n작은 실험이 전체 상황을 대표하는지도 검토해야 합니다. 실험에서 제외된 사람에게 불이익이 생길 수 있습니다.\n\n수정 제안\n“${thesis}”에 예외와 중단 조건을 명시하면 더 설득력 있는 주장이 됩니다.`,
    gemini: `${others[0]}의 논증 검토에 대하여\n성공 기준을 미리 정하자는 의견에 동의합니다. 다만 “${topic}”의 실제 환경에서는 변수들이 함께 움직이므로 단일 지표로 결론을 내리기는 어렵습니다.\n\n${others[1]}의 예외 검토에 대하여\n우려를 기록하되 우려가 확인되었을 때 대안을 실행할 절차까지 연결해야 합니다.\n\n수정 제안\n“${thesis}”를 검증할 비교 대상, 기간, 중단 기준을 함께 정합시다.`,
  };
  const closing: Record<ProviderId, string> = {
    gpt: `반박에 대한 답변\n${others[0]}가 제기한 측정 밖의 가치와 ${others[1]}가 제기한 복합 변수를 인정합니다. 지표만으로 결론을 정하지 않고 정성적 의견도 함께 검토해야 합니다.\n\n수정된 최종 입장\n“${topic}”에 관한 사용자 입론 “${thesis}”는 검증할 가설로 다루겠습니다. 효과, 비용, 예외를 비교하고 결론을 바꿀 조건을 먼저 합의하는 것이 좋습니다.\n\n입장 변화\n초기 논리 검토에서 예외와 다양한 평가 기준을 함께 고려하는 조건부 입장으로 보완했습니다.`,
    claude: `반박에 대한 답변\n${others[0]}의 지적처럼 예외의 존재만으로 주장을 부정해서는 안 됩니다. ${others[1]}가 제안한 중단 절차는 우려를 실제 실행 원칙으로 바꿀 수 있습니다.\n\n수정된 최종 입장\n“${topic}”의 입론 “${thesis}”에 예외 대상 보호, 이의 제기 절차, 재검토 시점을 추가할 것을 제안합니다.\n\n입장 변화\n위험을 지적하는 데서 나아가 위험을 관리할 수 있다면 제한적으로 시도할 수 있다는 입장으로 조정했습니다.`,
    gemini: `반박에 대한 답변\n${others[0]}의 사전 성공 기준과 ${others[1]}의 대표성 검토를 실험 설계에 반영하겠습니다. 작은 실험의 결과를 전체에 바로 일반화해서는 안 됩니다.\n\n수정된 최종 입장\n“${topic}”에 대한 “${thesis}”를 단계적으로 검증하되, 다양한 대상과 비교 기준을 포함하고 결과에 따라 확대·수정·중단을 결정할 것을 제안합니다.\n\n입장 변화\n단계적 실행이라는 최초 제안에 공정성과 검증 절차를 추가했습니다.`,
  };
  return prefix + (round === 1 ? opening : round === 2 ? rebuttal : closing)[providerId];
}
