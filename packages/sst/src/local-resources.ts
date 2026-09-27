import type { CloudFormationStackArtifact } from "@aws-cdk/cx-api";

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
  "AWS::DynamoDB::Table",
  "AWS::SNS::Topic",
  "AWS::SNS::TopicPolicy",
  "AWS::SNS::Subscription",
  "AWS::Scheduler::Schedule",
  "AWS::KMS::Key",
  "AWS::KMS::Alias",
  "AWS::IAM::ManagedPolicy",
  "AWS::EC2::NetworkAcl",
  "AWS::EC2::NetworkAclEntry",
  "AWS::EC2::SubnetNetworkAclAssociation",
  "AWS::Logs::LogStream",
  "AWS::Logs::SubscriptionFilter",
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Stage",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Integration",
  "AWS::ApiGatewayV2::Authorizer",
  "AWS::ApiGatewayV2::DomainName",
  "AWS::ApiGatewayV2::ApiMapping",
  "AWS::CertificateManager::Certificate",
  "AWS::CodeBuild::Project",
  "AWS::SES::ReceiptRuleSet",
  "AWS::SES::ReceiptRule",
  "Custom::AssetReplacer",
  "Custom::LogRetention",
  "Custom::AWS",
  "Custom::S3AutoDeleteObjects",
]);

/** Accept only the resource contracts exercised by local mode. */
export function validateLocalAssembly(
  stacks: readonly Pick<CloudFormationStackArtifact, "template" | "stackName">[]
) {
  const exports = new Map<
    string,
    { stack: (typeof stacks)[number]; value: any }
  >();
  for (const stack of stacks)
    for (const output of Object.values(stack.template.Outputs || {}) as any[])
      if (typeof output.Export?.Name === "string")
        exports.set(output.Export.Name, { stack, value: output.Value });

  function isQueueArn(
    stack: (typeof stacks)[number],
    value: any,
    seen = new Set<string>()
  ): boolean {
    const attr = value?.["Fn::GetAtt"];
    if (Array.isArray(attr))
      return (
        attr[1] === "Arn" &&
        stack.template.Resources?.[attr[0]]?.Type === "AWS::SQS::Queue"
      );
    const name = value?.["Fn::ImportValue"];
    if (typeof name !== "string" || seen.has(name)) return false;
    seen.add(name);
    const exported = exports.get(name);
    return !!exported && isQueueArn(exported.stack, exported.value, seen);
  }
  for (const stack of stacks)
    for (const [id, resource] of Object.entries(
      stack.template.Resources || {}
    ) as [string, any][]) {
      if (!supported.has(resource.Type))
        throw new Error(
          `Local mode does not support ${resource.Type} (${stack.stackName}/${id}).`
        );
      if (
        resource.Type === "AWS::Lambda::EventSourceMapping" &&
        !isQueueArn(stack, resource.Properties?.EventSourceArn)
      )
        throw new Error(
          `Local mode requires an SQS event source from this assembly (${stack.stackName}/${id}).`
        );
    }
}
