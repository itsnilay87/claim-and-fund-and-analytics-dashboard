import LitFundingKPIs from './LitFundingKPIs';
import UpfrontTailKPIs from './UpfrontTailKPIs';
import FullPurchaseKPIs from './FullPurchaseKPIs';
import StagedKPIs from './StagedKPIs';
import ComparativeKPIs from './ComparativeKPIs';

const KPI_MAP = {
  litigation_funding: LitFundingKPIs,
  monetisation_upfront_tail: UpfrontTailKPIs,
  monetisation_full_purchase: FullPurchaseKPIs,
  monetisation_staged: StagedKPIs,
  comparative: ComparativeKPIs,
};

export default function KPIRow({ data, structureType }) {
  const Component = KPI_MAP[structureType] || UpfrontTailKPIs;
  return <Component data={data} />;
}
