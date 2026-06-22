variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-west-2"
}

variable "project_name" {
  description = "Short name used as a prefix for all resources."
  type        = string
  default     = "scorecard-builder"
}

variable "lambda_image_tag" {
  description = "Tag of the backend image in ECR to deploy (the deploy workflow passes the git SHA)."
  type        = string
}
