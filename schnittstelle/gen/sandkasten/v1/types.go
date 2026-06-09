package sandkastenv1

import (
	"context"

	"github.com/golang/protobuf/proto"
	"google.golang.org/grpc"
)

type JobStatus int32

const (
	JobStatus_JOB_STATUS_UNSPECIFIED           JobStatus = 0
	JobStatus_JOB_STATUS_QUEUED                JobStatus = 1
	JobStatus_JOB_STATUS_VALIDATING            JobStatus = 2
	JobStatus_JOB_STATUS_COMPILING             JobStatus = 3
	JobStatus_JOB_STATUS_RUNNING               JobStatus = 4
	JobStatus_JOB_STATUS_SUCCEEDED             JobStatus = 5
	JobStatus_JOB_STATUS_COMPILE_FAILED        JobStatus = 6
	JobStatus_JOB_STATUS_RUNTIME_FAILED        JobStatus = 7
	JobStatus_JOB_STATUS_TIME_LIMIT_EXCEEDED   JobStatus = 8
	JobStatus_JOB_STATUS_MEMORY_LIMIT_EXCEEDED JobStatus = 9
	JobStatus_JOB_STATUS_OUTPUT_LIMIT_EXCEEDED JobStatus = 10
	JobStatus_JOB_STATUS_CANCELED              JobStatus = 11
	JobStatus_JOB_STATUS_SYSTEM_ERROR          JobStatus = 12
)

type SubmitGoProjectRequest struct {
	ArchiveTargz     []byte   `protobuf:"bytes,1,opt,name=archive_targz,json=archiveTargz,proto3" json:"archive_targz,omitempty"`
	Entrypoint       string   `protobuf:"bytes,2,opt,name=entrypoint,proto3" json:"entrypoint,omitempty"`
	Stdin            []byte   `protobuf:"bytes,3,opt,name=stdin,proto3" json:"stdin,omitempty"`
	Args             []string `protobuf:"bytes,4,rep,name=args,proto3" json:"args,omitempty"`
	CompileTimeoutMs uint32   `protobuf:"varint,5,opt,name=compile_timeout_ms,json=compileTimeoutMs,proto3" json:"compile_timeout_ms,omitempty"`
	RunTimeoutMs     uint32   `protobuf:"varint,6,opt,name=run_timeout_ms,json=runTimeoutMs,proto3" json:"run_timeout_ms,omitempty"`
	MemoryLimitBytes uint64   `protobuf:"varint,7,opt,name=memory_limit_bytes,json=memoryLimitBytes,proto3" json:"memory_limit_bytes,omitempty"`
	CpuMillis        uint32   `protobuf:"varint,8,opt,name=cpu_millis,json=cpuMillis,proto3" json:"cpu_millis,omitempty"`
	MaxOutputBytes   uint64   `protobuf:"varint,9,opt,name=max_output_bytes,json=maxOutputBytes,proto3" json:"max_output_bytes,omitempty"`
}

type SubmitGoProjectResponse struct {
	JobId  string    `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
	Status JobStatus `protobuf:"varint,2,opt,name=status,proto3,enum=sandkasten.v1.JobStatus" json:"status,omitempty"`
}

type GetJobRequest struct {
	JobId string `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
}

type StreamJobEventsRequest struct {
	JobId         string `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
	AfterSequence uint64 `protobuf:"varint,2,opt,name=after_sequence,json=afterSequence,proto3" json:"after_sequence,omitempty"`
}

type CancelJobRequest struct {
	JobId string `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
}

type CancelJobResponse struct {
	JobId  string    `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
	Status JobStatus `protobuf:"varint,2,opt,name=status,proto3,enum=sandkasten.v1.JobStatus" json:"status,omitempty"`
}

type Job struct {
	JobId            string     `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
	Status           JobStatus  `protobuf:"varint,2,opt,name=status,proto3,enum=sandkasten.v1.JobStatus" json:"status,omitempty"`
	Language         string     `protobuf:"bytes,3,opt,name=language,proto3" json:"language,omitempty"`
	Runtime          *Runtime   `protobuf:"bytes,4,opt,name=runtime,proto3" json:"runtime,omitempty"`
	Entrypoint       string     `protobuf:"bytes,5,opt,name=entrypoint,proto3" json:"entrypoint,omitempty"`
	Args             []string   `protobuf:"bytes,6,rep,name=args,proto3" json:"args,omitempty"`
	CompileTimeoutMs uint32     `protobuf:"varint,7,opt,name=compile_timeout_ms,json=compileTimeoutMs,proto3" json:"compile_timeout_ms,omitempty"`
	RunTimeoutMs     uint32     `protobuf:"varint,8,opt,name=run_timeout_ms,json=runTimeoutMs,proto3" json:"run_timeout_ms,omitempty"`
	MemoryLimitBytes uint64     `protobuf:"varint,9,opt,name=memory_limit_bytes,json=memoryLimitBytes,proto3" json:"memory_limit_bytes,omitempty"`
	CpuMillis        uint32     `protobuf:"varint,10,opt,name=cpu_millis,json=cpuMillis,proto3" json:"cpu_millis,omitempty"`
	MaxOutputBytes   uint64     `protobuf:"varint,11,opt,name=max_output_bytes,json=maxOutputBytes,proto3" json:"max_output_bytes,omitempty"`
	Result           *JobResult `protobuf:"bytes,12,opt,name=result,proto3" json:"result,omitempty"`
	ErrorMessage     string     `protobuf:"bytes,13,opt,name=error_message,json=errorMessage,proto3" json:"error_message,omitempty"`
	CreatedAt        string     `protobuf:"bytes,14,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
	StartedAt        string     `protobuf:"bytes,15,opt,name=started_at,json=startedAt,proto3" json:"started_at,omitempty"`
	FinishedAt       string     `protobuf:"bytes,16,opt,name=finished_at,json=finishedAt,proto3" json:"finished_at,omitempty"`
}

type JobResult struct {
	Stdout          []byte `protobuf:"bytes,1,opt,name=stdout,proto3" json:"stdout,omitempty"`
	Stderr          []byte `protobuf:"bytes,2,opt,name=stderr,proto3" json:"stderr,omitempty"`
	CompileStdout   []byte `protobuf:"bytes,3,opt,name=compile_stdout,json=compileStdout,proto3" json:"compile_stdout,omitempty"`
	CompileStderr   []byte `protobuf:"bytes,4,opt,name=compile_stderr,json=compileStderr,proto3" json:"compile_stderr,omitempty"`
	ExitCode        int32  `protobuf:"varint,5,opt,name=exit_code,json=exitCode,proto3" json:"exit_code,omitempty"`
	Signal          int32  `protobuf:"varint,6,opt,name=signal,proto3" json:"signal,omitempty"`
	WallTimeMs      uint64 `protobuf:"varint,7,opt,name=wall_time_ms,json=wallTimeMs,proto3" json:"wall_time_ms,omitempty"`
	MemoryPeakBytes uint64 `protobuf:"varint,8,opt,name=memory_peak_bytes,json=memoryPeakBytes,proto3" json:"memory_peak_bytes,omitempty"`
	StdoutTruncated bool   `protobuf:"varint,9,opt,name=stdout_truncated,json=stdoutTruncated,proto3" json:"stdout_truncated,omitempty"`
	StderrTruncated bool   `protobuf:"varint,10,opt,name=stderr_truncated,json=stderrTruncated,proto3" json:"stderr_truncated,omitempty"`
}

type JobEvent struct {
	JobId     string    `protobuf:"bytes,1,opt,name=job_id,json=jobId,proto3" json:"job_id,omitempty"`
	Sequence  uint64    `protobuf:"varint,2,opt,name=sequence,proto3" json:"sequence,omitempty"`
	Status    JobStatus `protobuf:"varint,3,opt,name=status,proto3,enum=sandkasten.v1.JobStatus" json:"status,omitempty"`
	Message   string    `protobuf:"bytes,4,opt,name=message,proto3" json:"message,omitempty"`
	CreatedAt string    `protobuf:"bytes,5,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
}

type ListRuntimesRequest struct{}

type ListRuntimesResponse struct {
	Runtimes []*Runtime `protobuf:"bytes,1,rep,name=runtimes,proto3" json:"runtimes,omitempty"`
}

type Runtime struct {
	Language       string `protobuf:"bytes,1,opt,name=language,proto3" json:"language,omitempty"`
	Version        string `protobuf:"bytes,2,opt,name=version,proto3" json:"version,omitempty"`
	Image          string `protobuf:"bytes,3,opt,name=image,proto3" json:"image,omitempty"`
	RequiresVendor bool   `protobuf:"varint,4,opt,name=requires_vendor,json=requiresVendor,proto3" json:"requires_vendor,omitempty"`
}

func (m *SubmitGoProjectRequest) Reset()         { *m = SubmitGoProjectRequest{} }
func (m *SubmitGoProjectRequest) String() string { return proto.CompactTextString(m) }
func (*SubmitGoProjectRequest) ProtoMessage()    {}

func (m *SubmitGoProjectResponse) Reset()         { *m = SubmitGoProjectResponse{} }
func (m *SubmitGoProjectResponse) String() string { return proto.CompactTextString(m) }
func (*SubmitGoProjectResponse) ProtoMessage()    {}

func (m *GetJobRequest) Reset()         { *m = GetJobRequest{} }
func (m *GetJobRequest) String() string { return proto.CompactTextString(m) }
func (*GetJobRequest) ProtoMessage()    {}

func (m *StreamJobEventsRequest) Reset()         { *m = StreamJobEventsRequest{} }
func (m *StreamJobEventsRequest) String() string { return proto.CompactTextString(m) }
func (*StreamJobEventsRequest) ProtoMessage()    {}

func (m *CancelJobRequest) Reset()         { *m = CancelJobRequest{} }
func (m *CancelJobRequest) String() string { return proto.CompactTextString(m) }
func (*CancelJobRequest) ProtoMessage()    {}

func (m *CancelJobResponse) Reset()         { *m = CancelJobResponse{} }
func (m *CancelJobResponse) String() string { return proto.CompactTextString(m) }
func (*CancelJobResponse) ProtoMessage()    {}

func (m *Job) Reset()         { *m = Job{} }
func (m *Job) String() string { return proto.CompactTextString(m) }
func (*Job) ProtoMessage()    {}

func (m *JobResult) Reset()         { *m = JobResult{} }
func (m *JobResult) String() string { return proto.CompactTextString(m) }
func (*JobResult) ProtoMessage()    {}

func (m *JobEvent) Reset()         { *m = JobEvent{} }
func (m *JobEvent) String() string { return proto.CompactTextString(m) }
func (*JobEvent) ProtoMessage()    {}

func (m *ListRuntimesRequest) Reset()         { *m = ListRuntimesRequest{} }
func (m *ListRuntimesRequest) String() string { return proto.CompactTextString(m) }
func (*ListRuntimesRequest) ProtoMessage()    {}

func (m *ListRuntimesResponse) Reset()         { *m = ListRuntimesResponse{} }
func (m *ListRuntimesResponse) String() string { return proto.CompactTextString(m) }
func (*ListRuntimesResponse) ProtoMessage()    {}

func (m *Runtime) Reset()         { *m = Runtime{} }
func (m *Runtime) String() string { return proto.CompactTextString(m) }
func (*Runtime) ProtoMessage()    {}

type JobServiceServer interface {
	SubmitGoProject(context.Context, *SubmitGoProjectRequest) (*SubmitGoProjectResponse, error)
	GetJob(context.Context, *GetJobRequest) (*Job, error)
	StreamJobEvents(*StreamJobEventsRequest, JobService_StreamJobEventsServer) error
	CancelJob(context.Context, *CancelJobRequest) (*CancelJobResponse, error)
}

type RuntimeServiceServer interface {
	ListRuntimes(context.Context, *ListRuntimesRequest) (*ListRuntimesResponse, error)
}

type JobService_StreamJobEventsServer interface {
	Send(*JobEvent) error
	grpc.ServerStream
}

func RegisterJobServiceServer(server *grpc.Server, srv JobServiceServer) {
	server.RegisterService(&JobService_ServiceDesc, srv)
}

func RegisterRuntimeServiceServer(server *grpc.Server, srv RuntimeServiceServer) {
	server.RegisterService(&RuntimeService_ServiceDesc, srv)
}

var JobService_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "sandkasten.v1.JobService",
	HandlerType: (*JobServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "SubmitGoProject",
			Handler:    _JobService_SubmitGoProject_Handler,
		},
		{
			MethodName: "GetJob",
			Handler:    _JobService_GetJob_Handler,
		},
		{
			MethodName: "CancelJob",
			Handler:    _JobService_CancelJob_Handler,
		},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "StreamJobEvents",
			Handler:       _JobService_StreamJobEvents_Handler,
			ServerStreams: true,
		},
	},
	Metadata: "sandkasten/v1/jobs.proto",
}

var RuntimeService_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "sandkasten.v1.RuntimeService",
	HandlerType: (*RuntimeServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "ListRuntimes",
			Handler:    _RuntimeService_ListRuntimes_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "sandkasten/v1/runtime.proto",
}

func _JobService_SubmitGoProject_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(SubmitGoProjectRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(JobServiceServer).SubmitGoProject(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/sandkasten.v1.JobService/SubmitGoProject",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(JobServiceServer).SubmitGoProject(ctx, req.(*SubmitGoProjectRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _JobService_GetJob_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetJobRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(JobServiceServer).GetJob(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/sandkasten.v1.JobService/GetJob",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(JobServiceServer).GetJob(ctx, req.(*GetJobRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _JobService_CancelJob_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(CancelJobRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(JobServiceServer).CancelJob(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/sandkasten.v1.JobService/CancelJob",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(JobServiceServer).CancelJob(ctx, req.(*CancelJobRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _JobService_StreamJobEvents_Handler(srv interface{}, stream grpc.ServerStream) error {
	m := new(StreamJobEventsRequest)
	if err := stream.RecvMsg(m); err != nil {
		return err
	}
	return srv.(JobServiceServer).StreamJobEvents(m, &jobServiceStreamJobEventsServer{stream})
}

type jobServiceStreamJobEventsServer struct {
	grpc.ServerStream
}

func (x *jobServiceStreamJobEventsServer) Send(m *JobEvent) error {
	return x.ServerStream.SendMsg(m)
}

func _RuntimeService_ListRuntimes_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListRuntimesRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(RuntimeServiceServer).ListRuntimes(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/sandkasten.v1.RuntimeService/ListRuntimes",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(RuntimeServiceServer).ListRuntimes(ctx, req.(*ListRuntimesRequest))
	}
	return interceptor(ctx, in, info, handler)
}
