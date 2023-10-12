import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx"
import { stringify } from "querystring";
import * as netmask from "netmask";

let config = new pulumi.Config();
const vpc = new aws.ec2.Vpc(config.require('vpc_name'), {

    cidrBlock: config.require('vpc_cidr') +"/" + config.require('vpc_mask'),
    enableDnsHostnames: true,
    tags: { Name: config.require('vpc_name') },

});

const availabilityZones = pulumi.output(aws.getAvailabilityZones());

const internetgateway = new aws.ec2.InternetGateway(config.require('igw_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('igw_name')},
});

const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];

const publicRouteTable = new aws.ec2.RouteTable(config.require('public_route_name'), {
    vpcId: vpc.id,
    tags: { Name:config.require('public_route_name') }
});

const privateRouteTable = new aws.ec2.RouteTable(config.require('private_route_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('private_route_name')}
});

const availabilityZonesResult = availabilityZones.apply(availabilityZones => availabilityZones.names.slice(0, 3));
var cidr_block = new netmask.Netmask(config.require('vpc_cidr') +"/" + config.require('subnet_mask'))

availabilityZonesResult.apply(availabilityZones => {
    availabilityZones.forEach((az, i) => {
        
        // Create a public subnet with a name tag
        const publicSubnet = new aws.ec2.Subnet(`public-subnet-${i}`, {
            cidrBlock: cidr_block.toString(),
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
                Name: `privateSubnet-${i}`, // Set the name tag
            },
        });
        cidr_block = cidr_block.next()
        privateSubnets.push(privateSubnet);

        new aws.ec2.RouteTableAssociation(`privateRouteTableAssociation-${i}`, {
            subnetId: privateSubnet.id,
            routeTableId: privateRouteTable.id,
        });
    });
});


new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: config.require('dest_cidr') +"/" + config.require('dest_mask'),
    gatewayId: internetgateway.id,
});
