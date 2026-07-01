output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.ec2.id
}

output "public_ip" {
  description = "Elastic IP address (stable across stop/start)"
  value       = aws_eip.ec2.public_ip
}

output "landing_page_url" {
  description = "React landing page — choose which framework to demo"
  value       = "http://${aws_eip.ec2.public_ip}"
}

output "flask_url" {
  description = "Flask app — React frontend + API bundled on port 4001"
  value       = "http://${aws_eip.ec2.public_ip}:4001"
}

output "node_frontend_url" {
  description = "Node.js React frontend (nginx)"
  value       = "http://${aws_eip.ec2.public_ip}:3002"
}

output "node_api_url" {
  description = "Node.js backend API — paste this into the frontend Base URL field"
  value       = "http://${aws_eip.ec2.public_ip}:4003"
}

output "gateway_url" {
  description = "API Gateway — authenticated entry point for all backend services"
  value       = "http://${aws_eip.ec2.public_ip}:8080"
}

output "django_frontend_url" {
  description = "Django React frontend (nginx)"
  value       = "http://${aws_eip.ec2.public_ip}:3003"
}

output "django_api_url" {
  description = "Django backend API — paste this into the frontend Base URL field"
  value       = "http://${aws_eip.ec2.public_ip}:4002"
}

output "ssh_command" {
  description = "SSH into the instance"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_eip.ec2.public_ip}"
}

output "bootstrap_log" {
  description = "Watch the Docker build progress (runs ~5 min on first boot)"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_eip.ec2.public_ip} 'tail -f /var/log/ec2-userdata.log'"
}
