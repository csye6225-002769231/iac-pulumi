import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as netmask from "netmask";

let config = new pulumi.Config();

const logGroup = new aws.cloudwatch.LogGroup("my-log-group", {
    name: "csye6225",
    
});

const logStream = new aws.cloudwatch.LogStream("my-log-stream", {
    name: "webapp",
    logGroupName: logGroup.name,
});


const vpc = new aws.ec2.Vpc(config.require('vpc_name'), {

    cidrBlock: config.require('vpc_cidr') + "/" + config.require('vpc_mask'),
    enableDnsHostnames: true,
    tags: { Name: config.require('vpc_name') },

});

const availabilityZones = pulumi.output(aws.getAvailabilityZones());

const internetgateway = new aws.ec2.InternetGateway(config.require('igw_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('igw_name') },
});

const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];

const publicRouteTable = new aws.ec2.RouteTable(config.require('public_route_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('public_route_name') }
});

const privateRouteTable = new aws.ec2.RouteTable(config.require('private_route_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('private_route_name') }
});

const availabilityZonesResult = availabilityZones.apply(availabilityZones => availabilityZones.names.slice(0, 3));
var cidr_block = new netmask.Netmask(config.require('vpc_cidr') + "/" + config.require('subnet_mask'))

availabilityZonesResult.apply(availabilityZones => {
    availabilityZones.forEach((az, i) => {

        // Create a public subnet with a name tag
        const publicSubnet = new aws.ec2.Subnet(`public-subnet-${i}`, {
            cidrBlock: cidr_block.toString(),
            mapPublicIpOnLaunch: true,
            vpcId: vpc.id,
            availabilityZone: az,
            tags: {
                Name: `publicSubnet-${i}`,
            },
        });
        cidr_block = cidr_block.next()
        publicSubnets.push(publicSubnet);

        new aws.ec2.RouteTableAssociation(`publicRouteTableAssociation-${i}`, {
            subnetId: publicSubnet.id,
            routeTableId: publicRouteTable.id,
        });

        const privateSubnet = new aws.ec2.Subnet(`private-subnet-${i}`, {
            cidrBlock: cidr_block.toString(),
            vpcId: vpc.id,
            availabilityZone: az,
            tags: {
                Name: `privateSubnet-${i}`, 
            },
        });
        cidr_block = cidr_block.next()
        privateSubnets.push(privateSubnet);

        new aws.ec2.RouteTableAssociation(`privateRouteTableAssociation-${i}`, {
            subnetId: privateSubnet.id,
            routeTableId: privateRouteTable.id,
        });
        if (i == 2) {

            const loadBalancer = new aws.ec2.SecurityGroup("load-balancer", {
                vpcId: vpc.id,
                ingress: [
                    {
                        protocol: "tcp",
                        fromPort: 80,
                        toPort: 80,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')]
                    },
                    {
                        protocol: "tcp",
                        fromPort: 443,
                        toPort: 443,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')]
                    },
                ]
            })

            
            const sg = new aws.ec2.SecurityGroup("webAppSecurityGroup", {
                vpcId: vpc.id,
                ingress: [
                    {
                        protocol: "tcp",
                        fromPort: 22,
                        toPort: 22,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')],
                    },
                    {
                        protocol: "tcp",
                        fromPort: 3000,
                        toPort: 3000,
                        securityGroups: [loadBalancer.id]
                    }
                ],
                egress:[
                    {
                    protocol: "tcp",
                    fromPort: 443,
                    toPort: 443,
                    cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')],
                    }
                ]
            });

            const egressforlb = new aws.ec2.SecurityGroupRule("egress-for-lb", {
                type: "egress",
                fromPort: 3000,
                toPort: 3000,
                protocol: "tcp",
                securityGroupId: loadBalancer.id,
                sourceSecurityGroupId: sg.id
            });


            const sg1 = new aws.ec2.SecurityGroup(config.require('sg1'), {
                vpcId: vpc.id,
                ingress: [
                    {
                        protocol: "tcp",
                        fromPort: 5432,
                        toPort: 5432,
                        // cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')],
                        securityGroups: [sg.id]
                    }]
            })

            const egressforrds = new aws.ec2.SecurityGroupRule("egress-for-rds", {
                type: "egress",
                fromPort: 5432,
                toPort: 5432,
                protocol: "tcp",
                securityGroupId: sg.id,
                sourceSecurityGroupId: sg1.id
            });


            const pgParameterGroup = new aws.rds.ParameterGroup("parameter-group", {
                family: "postgres15",
                description: "Parameter group for Postgres",
                parameters: [{
                    applyMethod: "pending-reboot",
                    name: "rds.force_ssl",
                    value: "0"
                }]
            })

            const Subnetgroup = new aws.rds.SubnetGroup("subnet-group", {
                subnetIds: [privateSubnets[0].id, privateSubnets[1].id],
            })

            const RDSInstance = new aws.rds.Instance("csye6225", {
                allocatedStorage: 20,
                engine: "postgres",
                engineVersion: "15.4",
                instanceClass: "db.t3.micro",
                multiAz: false,
                parameterGroupName: pgParameterGroup.name,
                username: config.require('username'),
                password: config.require('password'),
                dbName: config.require('database'),
                dbSubnetGroupName: Subnetgroup.name,
                publiclyAccessible: false,
                skipFinalSnapshot: true,
                vpcSecurityGroupIds: [sg1.id],
            });

            const ami_id = pulumi.output(aws.ec2.getAmi({
                filters: [
                    {
                        name: "name",
                        values: ["csye6225-ami-*"],
                    },
                    {
                        name: "root-device-type",
                        values: ["ebs"],
                    },
                    {
                        name: "virtualization-type",
                        values: ["hvm"],
                    },
                ],
                mostRecent: true,
                owners: [config.require('aws_account_id')],
            }))

            const role = new aws.iam.Role("role", {
                assumeRolePolicy: JSON.stringify({
                    "Version": "2012-10-17",
                    "Statement": [{
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "ec2.amazonaws.com"
                        },
                        "Action": "sts:AssumeRole",
                    }],
                }),
            });

            new aws.iam.RolePolicyAttachment("rolePolicyAttachment", {
                role: role.id,
                policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
            });


            const roleInstanceProfile = new aws.iam.InstanceProfile("roleInstanceProfile", {
                role: role.name,
            });

            const userData = pulumi.interpolate`#!/bin/bash
echo 'DATABASE_USER=${RDSInstance.username}' >> /etc/environment
echo 'DATABASE_PASS=${RDSInstance.password}' >> /etc/environment
echo 'DATABASE=${RDSInstance.dbName}' >> /etc/environment
echo "DATABASE_HOST=${RDSInstance.address}" >> /etc/environment
echo 'DATABASE_PORT=${config.require('port')}' >> /etc/environment
echo 'DIALECT=${config.require('dialect')}' >> /etc/environment
echo 'DEFAULTUSERSPATH=${config.require('defaultuserspath')}' >> /etc/environment
echo 'NODE_PORT=${config.require('node')}' >> /etc/environment
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
-a fetch-config \
-m ec2 \
-c file:/opt/webapp/cloudwatch-config.json \
-s
`;

            const asgLaunchConfig = new aws.ec2.LaunchTemplate("asgLaunchConfig", {
                imageId: ami_id.id,
                instanceType: "t2.micro",
                keyName: config.require('key-name'),
                iamInstanceProfile: { name: roleInstanceProfile.name },
                networkInterfaces:[
                    {
                    associatePublicIpAddress: "true",
                    securityGroups: [sg.id]
                    }
                ],
                disableApiTermination: false,
                blockDeviceMappings: [
                    {
                        deviceName: "/dev/xvda",
                        ebs: {
                            volumeSize: 20,
                            deleteOnTermination: "true",
                            volumeType: "gp2",
                        },
                    },
                ],
                userData: userData.apply(ud => Buffer.from(ud).toString('base64')),  

            })


            const asg = new aws.autoscaling.Group("asg", {
                vpcZoneIdentifiers: publicSubnets.map(subnet => subnet.id),
                desiredCapacity: 1,
                maxSize: 3,
                minSize: 1,
                defaultCooldown: 60,
                launchTemplate: {
                    id: asgLaunchConfig.id,
                    version: `$Latest`
                },
                tags: [{
                    key: "Name",
                    value: "ec2-asg-instance",
                    propagateAtLaunch: true,
                }],
            });

            const scaleUpPolicy = new aws.autoscaling.Policy("scaleUp", {
                adjustmentType: "ChangeInCapacity",
                autoscalingGroupName: asg.name,
                policyType: "SimpleScaling",
                cooldown: 60,
                scalingAdjustment: 1,
            });

            const scaleDownPolicy = new aws.autoscaling.Policy("scaleDown", {
                adjustmentType: "ChangeInCapacity",
                autoscalingGroupName: asg.name,
                cooldown: 60,
                policyType: "SimpleScaling",
                scalingAdjustment: -1,
            });

            const CPUHighAlarm = new aws.cloudwatch.MetricAlarm("CPUHigh", {
                alarmDescription: "Scale up if CPU usage is over 5%",
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 2,
                metricName: "CPUUtilization",
                namespace: "AWS/EC2",
                period: 60,
                statistic: "Average",
                threshold: 5,
                alarmActions: [scaleUpPolicy.arn],
                dimensions: {
                    AutoScalingGroupName: asg.name
                }
            });

            const CPULowAlarm = new aws.cloudwatch.MetricAlarm("CPULow", {
                alarmDescription: "Scale down if CPU usage is under 3%",
                comparisonOperator: "LessThanOrEqualToThreshold",
                evaluationPeriods: 2,
                metricName: "CPUUtilization",
                namespace: "AWS/EC2",
                period: 60,
                statistic: "Average",
                threshold: 3,
                alarmActions: [scaleDownPolicy.arn],
                dimensions: {
                    AutoScalingGroupName: asg.name
                }
            });


            const applicationLoadBalancer = new aws.lb.LoadBalancer("alb",{
                subnets: publicSubnets.map(subnet => subnet.id),
                securityGroups: [loadBalancer.id],
                internal: false,
                loadBalancerType: "application",
                enableDeletionProtection: false,
            });


            const targetGroup = new aws.lb.TargetGroup("targetGroup", {
                vpcId: vpc.id,
                port: 3000, 
                protocol: "HTTP",
                targetType: "instance",
                healthCheck:{
                    enabled: true,
                    path: "/healthz",
                    healthyThreshold: 3,
                    interval: 60,
                },

            });

            const frontEndListener = new aws.lb.Listener("feListener", {
                loadBalancerArn: applicationLoadBalancer.arn,
                port: 80,
                protocol: "HTTP",
                defaultActions: [{ 
                    type: "forward",
                    targetGroupArn: targetGroup.arn 
                }],
            });

            const attachment = new aws.autoscaling.Attachment("asgAttachment", {
                autoscalingGroupName: asg.name,
                lbTargetGroupArn: targetGroup.arn,
            }, 
            { dependsOn: [applicationLoadBalancer, targetGroup] });

            const record = new aws.route53.Record('record', {
                name: config.require('name'),
                type: 'A',
                zoneId: config.require('zone'),
                aliases: [{
                  name: applicationLoadBalancer.dnsName,
                  zoneId: applicationLoadBalancer.zoneId,
                  evaluateTargetHealth: true,
                }],    
              });
        }
    });

});
new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: config.require('dest_cidr') + "/" + config.require('dest_mask'),
    gatewayId: internetgateway.id,
});

