# Extensions and Future Improvements

Planned and potential enhancements to the scorecard builder, roughly
ordered by priority.

---

## Model Validation & Testing

- **Out-of-time (OOT) validation** - upload a holdout/validation dataset
  and compute AUC, GINI, KS, and score distribution on unseen data to
  assess model stability and overfitting.
- **Hosmer-Lemeshow test** - goodness-of-fit test for the logistic
  regression, checking whether predicted probabilities align with
  observed event rates across deciles.
- **Confusion matrix and classification metrics** - at user-defined
  score cutoffs, show precision, recall, F1, and a ROC curve.

## Scorecard Enhancements

- **Reject inference** - methods for incorporating rejected applicants
  into the development sample (parcelling, augmentation, fuzzy
  augmentation).
- **Score alignment validation** - automated check that higher scores
  consistently correspond to lower observed default rates across the
  full score range.
- **Scorecard reason codes** - for each observation, generate the top N
  factors contributing most to a low score (adverse action reasons),
  required for regulatory compliance in many jurisdictions.
- **Score-to-rating mapping** - map continuous scores to discrete rating
  grades with configurable boundaries and naming conventions.
- **Multi-target support** - build scorecards for different target
  definitions (e.g. 90 DPD vs 180 DPD, or LGD buckets) on the same
  dataset.

## Factor Engineering

- **Automated interaction detection** - systematically test pairwise
  interactions between shortlisted factors and surface those that
  improve model fit.
- **Weight of Evidence encoding alternatives** - support for fine/coarse
  classing presets, quantile-based binning, and custom binning
  templates importable from previous scorecards.
- **Categorical factor handling improvements** - ordered WoE for ordinal
  categoricals, rare-level grouping, and target encoding comparison.

## Workflow & UX

- **Session persistence** - save/load the full workflow state (all
  selections, overrides, binning, scorecard config) to a JSON file so
  users can resume from where they left off.
- **Comparison mode** - fit multiple scorecards with different factor
  sets or PDO parameters side-by-side and compare metrics.
- **Undo/redo** - state history for bin refinement changes.
- **Batch processing** - API-only mode for programmatic scorecard
  development without the UI (headless pipeline).
- **Dark mode** - theme toggle consistent with portfolio site.

## Infrastructure & Performance

- **Database-backed sessions** - replace the in-memory data store with
  DynamoDB or S3 for Lambda-compatible persistence across cold starts.
- **Async factor analysis** - parallelise univariate analysis across
  factors using background workers for large datasets.
- **Larger dataset support** - chunked CSV upload and streaming
  processing for datasets exceeding Lambda memory limits.
- **Custom domain** - Route 53 + ACM certificate for a branded URL.

## Integration

- **PD calibration pipeline** - direct integration with the
  [MAPA PD Calibration Tool](https://dcg14fdv56g8g.cloudfront.net)
  via API, eliminating the manual export/import step.
- **Model inventory export** - generate a model documentation package
  (model card) suitable for internal model validation or regulatory
  submission, including methodology, data description, performance
  metrics, and audit trail.
- **Version control for scorecards** - track scorecard versions with
  diffs showing what changed between iterations.
