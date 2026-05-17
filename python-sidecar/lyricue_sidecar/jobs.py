"""In-process job cancellation registry for sidecar learning work."""
from __future__ import annotations

from dataclasses import dataclass, field

from .protocol import ERROR_JOB_CANCELLED, JsonRpcError


@dataclass
class JobRegistry:
    cancelled: set[str] = field(default_factory=set)

    def cancel(self, job_id: str) -> dict[str, object]:
        self.cancelled.add(job_id)
        return {"jobId": job_id, "cancelled": True}

    def checkpoint(self, job_id: str | None) -> None:
        if job_id and job_id in self.cancelled:
            self.cancelled.discard(job_id)
            raise JsonRpcError(ERROR_JOB_CANCELLED, "Song-learning job was cancelled.", {"jobId": job_id})


jobs = JobRegistry()


def cancel_job_handler(params):
    if not isinstance(params, dict) or not isinstance(params.get("jobId"), str) or not params["jobId"]:
        from .protocol import ERROR_INVALID_PARAMS

        raise JsonRpcError(ERROR_INVALID_PARAMS, "params.jobId must be a non-empty string")
    return jobs.cancel(params["jobId"])
