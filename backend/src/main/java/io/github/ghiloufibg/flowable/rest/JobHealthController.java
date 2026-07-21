package io.github.ghiloufibg.flowable.rest;

import io.github.ghiloufibg.flowable.rest.dto.JobHealthDto;
import java.util.Comparator;
import java.util.Date;
import java.util.Objects;
import org.flowable.engine.ManagementService;
import org.flowable.job.api.Job;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Backs {@code GET custom/jobs/health} - see claudedocs/backend-library-design.md §7.2. */
@RestController
@RequestMapping("/custom/jobs")
public class JobHealthController {

  private final ManagementService managementService;

  public JobHealthController(ManagementService managementService) {
    this.managementService = managementService;
  }

  @GetMapping("/health")
  public JobHealthDto getJobHealth() {
    long timers = managementService.createTimerJobQuery().count();
    long async = managementService.createJobQuery().count();
    long dead = managementService.createDeadLetterJobQuery().count();
    long locked = managementService.createJobQuery().locked().count();

    java.time.Instant nextTimerDue =
        managementService.createTimerJobQuery().list().stream()
            .map(Job::getDuedate)
            .filter(Objects::nonNull)
            .min(Comparator.naturalOrder())
            .map(Date::toInstant)
            .orElse(null);

    java.time.Instant oldestAsyncCreated =
        managementService.createJobQuery().list().stream()
            .map(Job::getCreateTime)
            .filter(Objects::nonNull)
            .min(Comparator.naturalOrder())
            .map(Date::toInstant)
            .orElse(null);

    return new JobHealthDto(timers, async, dead, locked, nextTimerDue, oldestAsyncCreated);
  }
}
