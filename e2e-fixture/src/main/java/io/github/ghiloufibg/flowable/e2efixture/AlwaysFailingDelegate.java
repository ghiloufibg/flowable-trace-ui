package io.github.ghiloufibg.flowable.e2efixture;

import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;

/**
 * Always throws, so {@code refundWithDeadletter}'s async service task exhausts its retries ({@code
 * failedJobRetryTimeCycle=R1/PT1S}) and lands in the dead-letter queue - real dead-letter data for
 * the E2E suite to assert against, not a mocked count.
 */
public class AlwaysFailingDelegate implements JavaDelegate {

  @Override
  public void execute(DelegateExecution execution) {
    throw new RuntimeException("Deliberate failure for E2E fixture data (refund gateway offline)");
  }
}
