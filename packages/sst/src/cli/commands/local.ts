import type { Program } from "../program.js";

export const local = (program: Program) =>
  program.command(
    "local",
    "Run Node.js handlers locally with an isolated LocalStack instance",
    (yargs) =>
      yargs
        .option("env", {
          type: "string",
          demandOption: true,
          describe: "Unique local environment ID",
        })
        .option("endpoint", {
          type: "string",
          demandOption: true,
          describe: "LocalStack http://127.0.0.1:<port> endpoint",
        })
        .option("port", {
          type: "number",
          demandOption: true,
          describe: "Host bridge port reachable from Docker",
        }),
    async () => {
      const { useLocal } = await import("../../local.js");
      const { useProject } = await import("../../project.js");
      const { startLocalBridge } = await import("../../runtime/local.js");
      const { useBus } = await import("../../bus.js");
      const { Stacks } = await import("../../stacks/index.js");
      const { useAWSProvider, useAWSClient } = await import(
        "../../credentials.js"
      );
      const { LambdaClient, InvokeCommand } = await import(
        "@aws-sdk/client-lambda"
      );
      const { CfnOutput, Stack } = await import("aws-cdk-lib");
      const { RDSv2 } = await import("../../constructs/RDSv2.js");
      const { randomBytes } = await import("crypto");
      const fs = await import("fs/promises");
      const path = await import("path");
      const { fileURLToPath, pathToFileURL } = await import("url");
      const local = useLocal()!;
      const project = useProject();
      const lock = path.join(project.paths.out, "session.lock");
      try {
        const owner = Number(await fs.readFile(lock, "utf8"));
        try {
          process.kill(owner, 0);
          throw new Error(
            `Local environment ${local.id} is already running (PID ${owner}).`
          );
        } catch (error: any) {
          if (error.code !== "ESRCH") throw error;
        }
        await fs.unlink(lock);
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      const handle = await fs.open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      const stop = async (code: number) => {
        await fs.rm(lock, { force: true });
        process.exit(code);
      };
      process.once("SIGINT", () => void stop(0));
      process.once("SIGTERM", () => void stop(0));
      try {
        const tokenPath = path.join(project.paths.out, "bridge-token");
        local.token = await fs
          .readFile(tokenPath, "utf8")
          .catch(async (error) => {
            if (error.code !== "ENOENT") throw error;
            const token = randomBytes(32).toString("hex");
            await fs.writeFile(tokenPath, token, { mode: 0o600, flag: "wx" });
            return token;
          });
        process.env.AWS_REGION = project.config.region;
        const health = await fetch(`${local.endpoint}/_localstack/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!health.ok)
          throw new Error(
            "LocalStack is not ready. Start the example's Compose project with an authorized RDS/Data API entitlement."
          );
        const bus = useBus();
        bus.subscribe("worker.stdout", ({ properties: p }) =>
          console.log(`[${local.id} ${p.requestID}] ${p.message}`)
        );
        bus.subscribe("function.build.failed", ({ properties: p }) =>
          console.error(p.errors.join("\n"))
        );
        bus.subscribe("function.error", ({ properties: p }) =>
          console.error(`[${local.id} ${p.requestID}] ${p.errorMessage}`)
        );
        await startLocalBridge({
          host: "0.0.0.0",
          port: local.port,
          token: local.token,
        });

        const [, config] = await Stacks.load(project.paths.config);
        const assembly = await Stacks.synth({
          mode: "dev",
          fn: async (app) => {
            await config.stacks(app);
            for (const resource of app.node.findAll()) {
              if (resource instanceof RDSv2 && resource.migratorFunction)
                new CfnOutput(
                  Stack.of(resource),
                  `LocalMigration${resource.node.addr}`,
                  { value: resource.migratorFunction.functionName }
                );
            }
          },
        });
        // Only the example's resources and their CDK support resources are supported.
        const supported = new Set([
          "AWS::S3::Bucket",
          "AWS::S3::BucketPolicy",
          "AWS::SQS::Queue",
          "AWS::SQS::QueuePolicy",
          "AWS::RDS::DBCluster",
          "AWS::RDS::DBInstance",
          "AWS::RDS::DBSubnetGroup",
          "AWS::SecretsManager::Secret",
          "AWS::SecretsManager::SecretTargetAttachment",
          "AWS::EC2::VPC",
          "AWS::EC2::Subnet",
          "AWS::EC2::RouteTable",
          "AWS::EC2::Route",
          "AWS::EC2::SubnetRouteTableAssociation",
          "AWS::EC2::InternetGateway",
          "AWS::EC2::VPCGatewayAttachment",
          "AWS::EC2::SecurityGroup",
          "AWS::IAM::Role",
          "AWS::IAM::Policy",
          "AWS::SSM::Parameter",
          "AWS::Logs::LogGroup",
          "AWS::Lambda::Function",
          "AWS::Lambda::Permission",
          "AWS::Lambda::EventSourceMapping",
          "AWS::Lambda::EventInvokeConfig",
          "Custom::S3BucketNotifications",
          "Custom::SSTScript",
        ]);
        for (const stack of assembly.stacks) {
          for (const [id, resource] of Object.entries(
            stack.template.Resources || {}
          ) as [string, any][]) {
            if (!supported.has(resource.Type))
              throw new Error(
                `Local mode does not support ${resource.Type} (${id}). Use a regular SST stage.`
              );
            if (
              resource.Type === "AWS::SQS::Queue" &&
              resource.Properties?.FifoQueue
            )
              throw new Error(
                "Local mode currently supports standard SQS queues only."
              );
            if (resource.Type === "AWS::Lambda::EventSourceMapping") {
              const source = resource.Properties.EventSourceArn?.["Fn::GetAtt"];
              if (
                !Array.isArray(source) ||
                source[1] !== "Arn" ||
                stack.template.Resources[source[0]]?.Type !== "AWS::SQS::Queue"
              )
                throw new Error(
                  "Local mode only supports SQS event sources defined in the same stack."
                );
            }
          }
        }

        console.log(`[${local.id}] Bootstrapping local CDK resources`);
        const toolkit = path.dirname(
          fileURLToPath(await import.meta.resolve!("@aws-cdk/toolkit-lib"))
        );
        const { Bootstrapper } = await import(
          pathToFileURL(
            path.join(toolkit, "api/bootstrap/bootstrap-environment.js")
          ).href
        );
        const { IoHelper } = await import(
          pathToFileURL(path.join(toolkit, "api/io/private/io-helper.js")).href
        );
        await new Bootstrapper(
          { source: "default" },
          IoHelper.fromActionAwareIoHost({
            notify: async () => {},
            requestResponse: async (request: any) => request.defaultResponse,
          })
        ).bootstrapEnvironment(
          {
            account: "000000000000",
            region: project.config.region!,
            name: `aws://000000000000/${project.config.region}`,
          },
          await useAWSProvider()
        );
        const results = await Stacks.deployMany(assembly.stacks);
        for (const result of Object.values(results)) {
          if (Stacks.isFailed(result.status))
            throw new Error(JSON.stringify(result.errors));
        }
        const outputs = Object.assign(
          {},
          ...Object.values(results).map((r) => r.outputs)
        ) as Record<string, string>;
        for (const [key, functionName] of Object.entries(outputs)) {
          if (!key.startsWith("LocalMigration")) continue;
          console.log(`[${local.id}] Migrating ${functionName}`);
          const result = await useAWSClient(LambdaClient).send(
            new InvokeCommand({
              FunctionName: functionName,
              Payload: Buffer.from('{"type":"latest"}'),
            })
          );
          const payload = Buffer.from(result.Payload || []).toString();
          if (result.FunctionError)
            throw new Error(
              `Local database migration failed. Check RDS/Data API capability and migration logs: ${payload}`
            );
        }
        await fs.writeFile(
          path.join(project.paths.out, "outputs.json"),
          JSON.stringify(outputs, null, 2)
        );
        console.log(
          `[${local.id}] Local ready. Outputs: ${path.join(
            project.paths.out,
            "outputs.json"
          )}`
        );
      } catch (error) {
        console.error(error);
        await stop(1);
      }
    }
  );
