package io.github.ghiloufibg.flowable.rest;

/**
 * The three Flowable job categories, as reported on the wire ({@code EngineJobDto.type} / {@code
 * ProcessInstanceDto.JobItem.type}). Shared between {@link InstanceEnrichmentController} (produces
 * them per query loop) and {@link JobEnrichmentController} (produces them, and separately branches
 * on them in {@code loadLockInfo}) so a typo in one place can't silently break the other's
 * comparison.
 */
final class JobTypes {

  static final String TIMER = "timer";
  static final String ASYNC = "async";
  static final String DEADLETTER = "deadletter";

  private JobTypes() {}
}
