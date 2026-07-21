package io.github.ghiloufibg.flowable.e2efixture;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.flowable.engine.ManagementService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.Task;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

/**
 * Runnable app that seeds deterministic Flowable data on startup for the Playwright E2E suite to
 * point at. Test infrastructure only - never packaged/published as a library artifact. See
 * claudedocs/design-playwright-e2e-suite.md for the full rationale and the exact data shape this
 * produces (2 deployments, 2 definition keys, one with 2 versions, 14 historic instances, 12 of
 * them active, 2 dead-letter jobs).
 *
 * <p>{@code orderApproval} deliberately gets 12 instances, not a token handful: Flowable's own REST
 * default page size is a hardcoded 10 ({@link
 * io.github.ghiloufibg.flowable.FlowableDefaultPageSizeFilter}'s Javadoc has the full story) -
 * fewer than 11 rows anywhere would mean this suite passes identically whether that filter is
 * present, broken, or removed, silently defeating the one regression this fixture exists to catch.
 */
@SpringBootApplication
public class E2eFixtureApp {

  private static final Logger log = LoggerFactory.getLogger(E2eFixtureApp.class);

  public static void main(String[] args) {
    SpringApplication.run(E2eFixtureApp.class, args);
  }

  @Bean
  public ApplicationRunner seedRunner(
      RepositoryService repositoryService,
      RuntimeService runtimeService,
      TaskService taskService,
      ManagementService managementService,
      SeedStatus seedStatus) {
    return args -> {
      // orderApproval v1 is already auto-deployed from classpath:/processes/ by the time this
      // runner executes. Deploying the same resource again as a separate, explicitly-named
      // deployment bumps it to v2 (no duplicate-content filtering configured) - real 2-deployment,
      // 2-version data for the suite to test against, without maintaining a second BPMN file.
      repositoryService
          .createDeployment()
          .name("order-approval-v2")
          .addClasspathResource("processes/order-approval.bpmn20.xml")
          .deploy();

      // 2 completed (ended), 10 left active-with-a-pending-task - 12 total, comfortably past the
      // 10-row default described above.
      startAndComplete(runtimeService, taskService, "orderApproval", "ORD-1001");
      startAndComplete(runtimeService, taskService, "orderApproval", "ORD-1002");
      for (int i = 3; i <= 12; i++) {
        startActive(runtimeService, "orderApproval", "ORD-1" + String.format("%03d", i));
      }

      startActive(runtimeService, "refundWithDeadletter", "REF-2001");
      startActive(runtimeService, "refundWithDeadletter", "REF-2002");

      awaitDeadLetterJobs(managementService, 2, Duration.ofSeconds(30));

      seedStatus.markReady();
      log.info("E2E fixture data seeded and ready.");
    };
  }

  private static ProcessInstance startActive(
      RuntimeService runtimeService, String processKey, String businessKey) {
    Map<String, Object> variables = new HashMap<>();
    variables.put("orderId", businessKey);
    return runtimeService.startProcessInstanceByKey(processKey, businessKey, variables);
  }

  private static void startAndComplete(
      RuntimeService runtimeService,
      TaskService taskService,
      String processKey,
      String businessKey) {
    ProcessInstance instance = startActive(runtimeService, processKey, businessKey);
    Task task = taskService.createTaskQuery().processInstanceId(instance.getId()).singleResult();
    if (task != null) {
      taskService.complete(task.getId());
    }
  }

  /**
   * The async executor picks up {@code refundWithDeadletter}'s failing service task on a background
   * thread; polling here (rather than a fixed sleep) means the fixture is ready as soon as both
   * instances have genuinely exhausted their retries, no slower or flakier than necessary.
   */
  private static void awaitDeadLetterJobs(
      ManagementService managementService, int expectedCount, Duration timeout) {
    Instant deadline = Instant.now().plus(timeout);
    while (Instant.now().isBefore(deadline)) {
      long count = managementService.createDeadLetterJobQuery().count();
      if (count >= expectedCount) {
        return;
      }
      try {
        Thread.sleep(500);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        return;
      }
    }
    log.warn(
        "Timed out waiting for {} dead-letter jobs after {} - proceeding anyway.",
        expectedCount,
        timeout);
  }
}
