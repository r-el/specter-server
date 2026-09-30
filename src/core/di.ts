import "reflect-metadata";
import { container, instanceCachingFactory } from "tsyringe";
import { CameraService } from "@cameras/cameraService.js";
import { CameraSettingsService } from "@cameras/cameraSettingsService.js";
import { AlertService } from "@alerts/alertService.js";
import { ALERT_REPOSITORY } from "@alerts/infrastructure/tokens.js";
import { SpecterAlertRepository } from "@alerts/infrastructure/specterAlertRepository.js";
import { UserService } from "@users/userService.js";
import { USER_REPOSITORY } from "@users/infrastructure/tokens.js";
import { SupabaseUserRepository } from "@users/infrastructure/supabaseUserRepository.js";
import { WatchlistService } from "@watchlists/watchlistService.js";
import { AuthService } from "@auth/authService.js";
import { CAMERA_ASSIGNMENT_REPOSITORY, CAMERA_REPOSITORY } from "@cameras/infrastructure/tokens.js";
import { SpecterCameraRepository } from "@cameras/infrastructure/specterCameraRepository.js";
import { SupabaseCameraAssignmentRepository } from "@cameras/infrastructure/supabaseCameraAssignmentRepository.js";
import { VECTOR_REPOSITORY } from "@vector/infrastructure/tokens.js";
import { QdrantVectorRepository } from "@vector/infrastructure/qdrantVectorRepository.js";
import { loadSpecterConfig, type SpecterConfig } from "@specter/specterConfig.js";
import { SpecterHttpClient } from "@specter/specterHttpClient.js";
import { SpecterEventStream } from "@specter/specterEventStream.js";
import { SpecterCatalog } from "@specter/specterCatalog.js";
import {
  SPECTER_CATALOG,
  SPECTER_CONFIG,
  SPECTER_EVENT_STREAM,
  SPECTER_HTTP_CLIENT,
} from "@specter/tokens.js";

// Register services in DI container
container.registerSingleton(CameraService);
container.registerSingleton(CameraSettingsService);
container.registerSingleton(AlertService);
container.registerSingleton(UserService);
container.registerSingleton(USER_REPOSITORY, SupabaseUserRepository);
container.registerSingleton(WatchlistService);
container.registerSingleton(AuthService);
container.registerSingleton(CAMERA_REPOSITORY, SpecterCameraRepository);
container.registerSingleton(CAMERA_ASSIGNMENT_REPOSITORY, SupabaseCameraAssignmentRepository);
container.registerSingleton(ALERT_REPOSITORY, SpecterAlertRepository);
container.registerSingleton(VECTOR_REPOSITORY, QdrantVectorRepository);

container.register<SpecterConfig>(SPECTER_CONFIG, {
  useFactory: instanceCachingFactory(() => loadSpecterConfig()),
});
container.register<SpecterHttpClient>(SPECTER_HTTP_CLIENT, {
  useFactory: instanceCachingFactory((c) => new SpecterHttpClient(c.resolve(SPECTER_CONFIG))),
});
container.register<SpecterEventStream>(SPECTER_EVENT_STREAM, {
  useFactory: instanceCachingFactory((c) => new SpecterEventStream(c.resolve(SPECTER_CONFIG))),
});
container.register<SpecterCatalog>(SPECTER_CATALOG, {
  useFactory: instanceCachingFactory((c) => new SpecterCatalog(c.resolve(SPECTER_HTTP_CLIENT))),
});

export { container };
